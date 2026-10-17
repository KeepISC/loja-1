import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import cors from 'cors';
import session from 'express-session';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { publicDir, uploadDir, requireDevelopment } from './config.js';
import { ensureGuest, resolveGuest, revokeGuest } from './guest-access.js';
import { createAppearanceRepository, themeIds } from './appearance.js';

declare module 'express-session' {
  interface SessionData {
    userRole?: 'ADMIN' | 'GUEST';
    customerId?: string;
  }
}

const prisma = new PrismaClient();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error('Only PNG, JPG and WEBP images are allowed.'));
      return;
    }
    cb(null, true);
  },
});

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve().then(() => handler(req, res, next)).catch(next);
};

function imageType(bytes: Buffer) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && bytes.toString('ascii', 12, 16) === 'IHDR') return { mime: 'image/png', extension: 'png' };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8
    && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return { mime: 'image/webp', extension: 'webp' };
  return null;
}

type OrderWithData = Prisma.OrderGetPayload<{ include: { items: true; payment: true; emailDelivery: true } }>;

function customerOrder(order: OrderWithData) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerEmail: order.customerEmail,
    status: order.status,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    items: order.items.map(({ categoryId, categoryName, priceCents, quantity }) => ({ categoryId, categoryName, priceCents, quantity })),
    payment: order.payment ? { status: order.payment.status, provider: order.payment.provider } : null,
    emailDelivery: order.emailDelivery ? { status: order.emailDelivery.status } : null,
  };
}

export function createApp(options: { uploadDirectory?: string } = {}) {
  requireDevelopment();
  const app = express();
  const appearance = createAppearanceRepository(prisma);
  const uploads = options.uploadDirectory ?? uploadDir;

  app.use((_req, res, next) => {
    if (process.env.NODE_ENV !== 'development') return res.status(503).json({ error: 'Development providers are disabled.' });
    next();
  });
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  // Never serve arbitrary files from the upload directory, including legacy SVG/HTML uploads.
  app.get('/uploads/:filename', asyncRoute(async (req, res) => {
    const filename = String(req.params.filename);
    if (!/^[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$/i.test(filename)) throw new HttpError(404, 'Image not found.');
    let bytes: Buffer;
    try { bytes = await fs.readFile(path.join(uploads, filename)); }
    catch (error: any) { if (error.code === 'ENOENT') throw new HttpError(404, 'Image not found.'); throw error; }
    const type = imageType(bytes);
    if (!type || (path.extname(filename).toLowerCase().replace('.', '').replace('jpeg', 'jpg') !== type.extension)) {
      throw new HttpError(404, 'Image not found.');
    }
    res.set({ 'Content-Type': type.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline' });
    res.send(bytes);
  }));
  app.use('/images', express.static(path.join(publicDir, 'images')));

  app.use(
    session({
      secret: process.env.SESSION_SECRET || randomUUID(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
      name: 'market_session',
    }),
  );

  app.use(asyncRoute(async (req, _res, next) => {
    req.guestCustomerId = await resolveGuest(req, prisma);
    next();
  }));

  const requireRole = (role: 'ADMIN' | 'GUEST') => {
    return (req: any, res: any, next: any) => {
      const currentRole = req.session?.userRole ?? 'GUEST';
      if (currentRole !== role && !(role === 'GUEST' && currentRole === 'ADMIN')) {
        return res.status(403).json({ error: 'Forbidden: missing required role.' });
      }
      return next();
    };
  };

  const currentUser = (req: any) => {
    const role = req.session?.userRole || 'GUEST';
    return {
      role,
      displayName: role === 'ADMIN' ? 'Mock Administrator' : 'Mock Guest',
      email: role === 'ADMIN' ? 'admin@local.test' : 'guest@local.test',
      mode: 'development',
      mockAccountSwitchingEnabled: true,
    };
  };

  const isDevelopment = () => process.env.NODE_ENV === 'development';
  const requireMockPayment: RequestHandler = (_req, res, next) => {
    if (!isDevelopment() || process.env.ALLOW_MOCK_PAYMENT !== 'true') {
      return res.status(403).json({ error: 'Mock payment must be explicitly enabled in development.' });
    }
    next();
  };

  const canAccessOrder = (req: express.Request, order: { userId: string | null }) =>
    req.session.userRole === 'ADMIN' || Boolean(req.guestCustomerId && order.userId === req.guestCustomerId);

  const categorySchema = z.object({
    name: z.string().min(2).max(80),
    slug: z.string().min(2).max(80),
    description: z.string().min(10).max(2000),
    priceCents: z.number().int().positive(),
    active: z.boolean().optional().default(true),
  });

  const contactSchema = z.object({
    supplierName: z.string().min(2).max(80),
    email: z.string().email(),
    telephone: z.string().max(80).optional().or(z.literal('')),
    whatsapp: z.string().max(80).optional().or(z.literal('')),
    website: z.string().max(200).optional().or(z.literal('')),
    notes: z.string().max(1500).optional().or(z.literal('')),
  });

  const sanitizeCategory = (category: any) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    priceCents: category.priceCents,
    imageUrl: category.imageUrl,
    active: category.active,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  });

  function getPublicCategory(category: any) {
    return {
      ...sanitizeCategory(category),
      supplierContactsCount: Array.isArray(category.contacts) ? category.contacts.length : 0,
    };
  }

  class DummyPaymentProvider {
    async confirmPayment(orderId: string) {
      return prisma.$transaction(async (tx) => {
        // Take the SQLite write lock before reading: concurrent callbacks cannot both transition it.
        await tx.payment.updateMany({
          where: { orderId, status: 'PENDING', provider: 'DUMMY' },
          data: { status: 'PAID', confirmedAt: new Date() },
        });
        const payment = await tx.payment.findUnique({ where: { orderId } });
        if (!payment || payment.provider !== 'DUMMY' || payment.status !== 'PAID') {
          throw new HttpError(409, 'Payment cannot be confirmed in its current state.');
        }
        const updated = await tx.order.updateMany({
          where: { id: orderId, status: { in: ['PENDING', 'PAID'] } },
          data: { status: 'PAID' },
        });
        if (!updated.count) throw new HttpError(409, 'Order cannot be confirmed in its current state.');
        return payment;
      }, { maxWait: 10000, timeout: 10000 });
    }
  }

  class DummyEmailProvider {
    async sendOrderDeliveryEmail(orderId: string) {
      try {
        return await prisma.$transaction(async (tx) => {
          // The existing delivery row is the local dummy outbox. Claim and send are one commit,
          // with no filesystem/network side effect that could succeed before its status is saved.
          const claim = await tx.emailDelivery.updateMany({
            where: {
              orderId, status: { not: 'SENT' },
              order: { status: 'PAID', payment: { is: { status: 'PAID' } } },
            },
            data: { status: 'SENDING' },
          });
          const order = await tx.order.findUnique({
            where: { id: orderId }, include: { payment: true, emailDelivery: true, items: true },
          });
          if (!order) throw new HttpError(404, 'Order not found.');
          if (order.status !== 'PAID' || order.payment?.status !== 'PAID') {
            throw new HttpError(409, 'Contacts can only be delivered after payment confirmation.');
          }
          if (!claim.count) {
            if (order.emailDelivery?.status === 'SENT') return order.emailDelivery;
            throw new HttpError(409, 'Delivery record is unavailable.');
          }
          const categories = await tx.category.findMany({
            where: { id: { in: order.items.map((item) => item.categoryId) } },
            include: { contacts: true },
          });
          const body = [
            `Pedido: ${order.orderNumber}`,
            `Destinat?rio: ${order.customerEmail}`,
            '', 'Categorias compradas:',
            ...categories.map((category) => `- ${category.name}`),
            '', 'Contactos dos fornecedores:',
            ...categories.flatMap((category) => [
              `Categoria: ${category.name}`,
              ...category.contacts.flatMap((contact) => [
                `- ${contact.supplierName}`,
                `  Email: ${contact.email}`,
                `  Telefone: ${contact.telephone || 'N/A'}`,
                `  WhatsApp: ${contact.whatsapp || 'N/A'}`,
                `  Website: ${contact.website || 'N/A'}`,
                `  Notas: ${contact.notes || 'N/A'}`,
              ]),
            ]),
          ].join('\n');
          return tx.emailDelivery.update({
            where: { orderId },
            data: {
              status: 'SENT', recipient: order.customerEmail,
              subject: `Entrega de contactos do pedido ${order.orderNumber}`,
              body, attempts: { increment: 1 }, lastError: null,
            },
          });
        }, { maxWait: 10000, timeout: 10000 });
      } catch (error) {
        if (!(error instanceof HttpError)) {
          // A database outage may also prevent recording failure; the original error still reaches middleware.
          await prisma.emailDelivery.updateMany({
            where: { orderId, status: { not: 'SENT' }, order: { status: 'PAID', payment: { is: { status: 'PAID' } } } },
            data: { status: 'FAILED', attempts: { increment: 1 }, lastError: 'Local delivery failed; retry this paid order.' },
          }).catch(() => undefined);
        }
        throw error;
      }
    }
  }

  const paymentProvider = new DummyPaymentProvider();
  const emailProvider = new DummyEmailProvider();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, status: 'healthy' });
  });

  app.get('/api/appearance', asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ theme: await appearance.read() });
  }));

  app.put('/api/admin/appearance', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const parsed = z.object({ theme: z.enum(themeIds) }).strict().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid theme.');
    res.set('Cache-Control', 'no-store').json({ theme: await appearance.write(parsed.data.theme) });
  }));

  app.get('/api/auth/me', asyncRoute(async (req, res) => {
    await ensureGuest(req, res, prisma);
    res.json({
      ...currentUser(req),
      mode: process.env.NODE_ENV || 'development',
      mockAccountSwitchingEnabled: isDevelopment(),
    });
  }));

  app.post('/api/dev/session', (req, res) => {
    if (!isDevelopment()) {
      return res.status(403).json({ error: 'Mock account switcher is only available in development mode.' });
    }

    const body = z.object({ role: z.enum(['ADMIN', 'GUEST']) }).safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: 'Invalid role.' });
    }

    req.session.userRole = body.data.role;
    return res.json({ ok: true, user: currentUser(req) });
  });

  app.post('/api/dev/session/clear', asyncRoute(async (req, res) => {
    await revokeGuest(req, res, prisma);
    await new Promise<void>((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
    res.clearCookie('market_session');
    res.json({ ok: true });
  }));

  app.get('/api/categories', asyncRoute(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ items: categories.map(sanitizeCategory) });
  }));

  app.get('/api/categories/:slug', asyncRoute(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { slug: String(req.params.slug) },
      include: { contacts: true },
    });

    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    return res.json({
      item: getPublicCategory(category),
      supplierContactsCount: category.contacts.length,
    });
  }));

  app.post('/api/orders', asyncRoute(async (req: any, res) => {
    const role = req.session?.userRole || 'GUEST';
    if (role !== 'GUEST' && role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only guest customers can place orders.' });
    }

    const parsed = z.object({
      customerEmail: z.string().email(),
      checkoutKey: z.string().uuid().optional(),
      items: z.array(z.object({ categoryId: z.string() })).min(1),
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Order payload is invalid.' });
    }

    const seen = new Set<string>();
    const itemIds = parsed.data.items
      .map((item) => item.categoryId)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

    const customerId = await ensureGuest(req, res, prisma);
    await new Promise<void>((resolve, reject) => req.session.save((error: Error | null) => error ? reject(error) : resolve()));
    const orderNumber = parsed.data.checkoutKey
      ? `ORD-${createHash('sha256').update(`${customerId}:${parsed.data.checkoutKey}`).digest('hex')}`
      : `ORD-${randomUUID()}`;
    const previousCheckout = async () => {
      const existing = await prisma.order.findUnique({
        where: { orderNumber }, include: { items: true, payment: true, emailDelivery: true },
      });
      if (!existing) return null;
      if (existing.userId !== customerId || existing.customerEmail !== parsed.data.customerEmail
        || existing.items.length !== itemIds.length || existing.items.some((item) => !itemIds.includes(item.categoryId))) {
        throw new HttpError(409, 'Checkout key was already used for a different purchase.');
      }
      return existing;
    };
    const previous = await previousCheckout();
    if (previous) return res.json({ order: customerOrder(previous) });

    const categories = await prisma.category.findMany({
      where: { id: { in: itemIds }, active: true },
    });

    if (categories.length !== itemIds.length) {
      return res.status(400).json({ error: 'One or more categories are unavailable.' });
    }

    let order: OrderWithData;
    try {
      // Prisma nested writes create the order, items, payment and delivery in one transaction.
      order = await prisma.order.create({
        data: {
          orderNumber, customerEmail: parsed.data.customerEmail,
          status: 'PENDING', totalCents: categories.reduce((total, category) => total + category.priceCents, 0),
          user: {
            connectOrCreate: {
              where: { id: customerId },
              create: { id: customerId, email: `guest-${customerId}@local.test`, role: 'GUEST', displayName: 'Mock Guest' },
            },
          },
          items: { create: categories.map((category) => ({
            categoryId: category.id, categoryName: category.name, priceCents: category.priceCents, quantity: 1,
          })) },
          payment: { create: { status: 'PENDING', provider: 'DUMMY' } },
          emailDelivery: { create: {
            status: 'NOT_SENT', recipient: parsed.data.customerEmail, subject: `Pedido ${orderNumber}`, body: '', attempts: 0,
          } },
        },
        include: { items: true, payment: true, emailDelivery: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await previousCheckout();
        if (existing) return res.json({ order: customerOrder(existing) });
      }
      throw error;
    }
    return res.status(201).json({ order: customerOrder(order) });
  }));

  app.get('/api/orders', asyncRoute(async (req, res) => {
    if (!req.guestCustomerId) throw new HttpError(401, 'Guest authorization required.');
    const orders = await prisma.order.findMany({
      where: { userId: req.guestCustomerId },
      orderBy: { createdAt: 'desc' },
      include: { items: true, payment: true, emailDelivery: true },
    });
    return res.json({ items: orders.map(customerOrder) });
  }));

  app.get('/api/orders/:id/delivery', asyncRoute(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: String(req.params.id) }, include: { payment: true, emailDelivery: true },
    });
    if (!order || !canAccessOrder(req, order)) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'PAID' || order.payment?.status !== 'PAID' || order.emailDelivery?.status !== 'SENT') {
      throw new HttpError(409, 'Delivery is only available after confirmed payment and successful delivery.');
    }
    const { recipient, subject, body } = order.emailDelivery;
    return res.json({ delivery: { recipient, subject, body } });
  }));

  app.get('/api/orders/:id', asyncRoute(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { id: String(req.params.id) }, include: { items: true, payment: true, emailDelivery: true },
    });
    if (!order || !canAccessOrder(req, order)) throw new HttpError(404, 'Order not found.');
    return res.json({ order: customerOrder(order) });
  }));

  const confirmAndDeliver = async (orderId: string) => {
    await paymentProvider.confirmPayment(orderId);
    await emailProvider.sendOrderDeliveryEmail(orderId);
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId }, include: { items: true, payment: true, emailDelivery: true },
    });
    const safeOrder = customerOrder(order);
    return { order: safeOrder, payment: safeOrder.payment, email: safeOrder.emailDelivery, deliveryStatus: safeOrder.emailDelivery?.status };
  };

  app.post('/api/dev/payments/:orderId/simulate', requireMockPayment, asyncRoute(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: String(req.params.orderId) } });
    if (!order || !canAccessOrder(req, order)) throw new HttpError(404, 'Order not found.');
    return res.json(await confirmAndDeliver(order.id));
  }));

  app.post('/api/admin/orders/:orderId/confirm-payment', requireRole('ADMIN'), requireMockPayment, asyncRoute(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: String(req.params.orderId) } });
    if (!order) throw new HttpError(404, 'Order not found.');
    return res.json(await confirmAndDeliver(order.id));
  }));

  app.get('/api/admin/dashboard', requireRole('ADMIN'), asyncRoute(async (_req, res) => {
    const [totalCategories, activeCategories, totalOrders, paidOrders, revenue] = await Promise.all([
      prisma.category.count(),
      prisma.category.count({ where: { active: true } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: 'PAID' } }),
      prisma.order.aggregate({
        _sum: { totalCents: true },
        where: { status: 'PAID' },
      }),
    ]);

    res.json({
      totalCategories,
      activeCategories,
      totalOrders,
      paidOrders,
      totalRevenueCents: revenue._sum.totalCents ?? 0,
    });
  }));

  app.get('/api/admin/categories', requireRole('ADMIN'), asyncRoute(async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { createdAt: 'desc' },
      include: { contacts: true },
    });
    res.json({ items: categories });
  }));

  app.post('/api/admin/categories', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid category payload.' });
    }

    const category = await prisma.category.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description,
        priceCents: parsed.data.priceCents,
        imageUrl: '/images/default-category.svg',
        active: parsed.data.active,
      },
    });

    return res.status(201).json({ item: category });
  }));

  app.put('/api/admin/categories/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid category payload.' });
    }

    const category = await prisma.category.update({
      where: { id: String(req.params.id) },
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description,
        priceCents: parsed.data.priceCents,
        active: parsed.data.active,
      },
    });

    return res.json({ item: category });
  }));

  app.delete('/api/admin/categories/:id', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const category = await prisma.category.findUnique({ where: { id: String(req.params.id) } });
    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    await prisma.category.update({
      where: { id: String(req.params.id) },
      data: { active: false },
    });

    return res.json({ ok: true });
  }));

  app.post('/api/admin/categories/:id/image', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const category = await prisma.category.findUnique({ where: { id: String(req.params.id) } });
    if (!category) throw new HttpError(404, 'Category not found.');
    await new Promise<void>((resolve, reject) => upload.single('image')(req, res, (error) => error ? reject(new HttpError(400, error.message)) : resolve()));
    const file = req.file;
    if (!file) throw new HttpError(400, 'No image was uploaded.');
    const type = imageType(file.buffer);
    if (!type || type.mime !== file.mimetype) throw new HttpError(400, 'Image bytes do not match a supported raster format.');
    const filename = `${randomUUID()}.${type.extension}`;
    const destination = path.join(uploads, filename);
    await fs.mkdir(uploads, { recursive: true });
    await fs.writeFile(destination, file.buffer, { flag: 'wx' });
    try {
      await prisma.category.update({ where: { id: category.id }, data: { imageUrl: `/uploads/${filename}` } });
    } catch (error) {
      await fs.unlink(destination).catch(() => undefined);
      throw error;
    }
    return res.json({ imageUrl: `/uploads/${filename}` });
  }));

  app.get('/api/admin/categories/:id/contacts', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { id: String(req.params.id) },
      include: { contacts: true },
    });

    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    res.json({ contacts: category.contacts });
  }));

  app.post('/api/admin/categories/:id/contacts', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid contact payload.' });
    }

    const category = await prisma.category.findUnique({ where: { id: String(req.params.id) } });
    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const item = await prisma.supplierContact.create({
      data: {
        categoryId: String(req.params.id),
        supplierName: parsed.data.supplierName,
        email: parsed.data.email,
        telephone: parsed.data.telephone || null,
        whatsapp: parsed.data.whatsapp || null,
        website: parsed.data.website || null,
        notes: parsed.data.notes || null,
      },
    });

    return res.status(201).json({ item });
  }));

  app.put('/api/admin/categories/:categoryId/contacts/:contactId', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid contact payload.' });
    }

    const item = await prisma.supplierContact.update({
      where: { id: String(req.params.contactId) },
      data: {
        supplierName: parsed.data.supplierName,
        email: parsed.data.email,
        telephone: parsed.data.telephone || null,
        whatsapp: parsed.data.whatsapp || null,
        website: parsed.data.website || null,
        notes: parsed.data.notes || null,
      },
    });

    return res.json({ item });
  }));

  app.delete('/api/admin/categories/:categoryId/contacts/:contactId', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    await prisma.supplierContact.delete({ where: { id: String(req.params.contactId) } });
    return res.json({ ok: true });
  }));

  app.get('/api/admin/orders', requireRole('ADMIN'), asyncRoute(async (_req, res) => {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: true, payment: true, emailDelivery: true },
    });
    res.json({ items: orders.map(customerOrder) });
  }));

  app.get('/api/dev/email-outbox', requireRole('ADMIN'), asyncRoute(async (_req, res) => {
    const outbox = await prisma.emailDelivery.findMany({
      orderBy: { createdAt: 'desc' }, include: { order: { include: { payment: true } } },
    });
    // Do not expose contact bodies from legacy unpaid deliveries either.
    return res.json({ items: outbox.map((delivery) => ({
      id: delivery.id, orderId: delivery.orderId, status: delivery.status, recipient: delivery.recipient,
      subject: delivery.subject, createdAt: delivery.createdAt, attempts: delivery.attempts, lastError: delivery.lastError,
      body: delivery.status === 'SENT' && delivery.order.status === 'PAID' && delivery.order.payment?.status === 'PAID' ? delivery.body : '',
      order: { orderNumber: delivery.order.orderNumber },
    })) });
  }));

  app.post('/api/dev/email-outbox/retry/:orderId', requireRole('ADMIN'), asyncRoute(async (req, res) => {
    const delivery = await emailProvider.sendOrderDeliveryEmail(String(req.params.orderId));
    return res.json({ delivery: { status: delivery.status }, email: { status: delivery.status } });
  }));

  const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return res.status(409).json({ error: 'A record with that identifier already exists.' });
      if (error.code === 'P2025') return res.status(404).json({ error: 'Record not found.' });
      if (error.code === 'P2003') return res.status(400).json({ error: 'Invalid related record.' });
    }
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    return res.status(500).json({ error: 'Request could not be completed. Retry the existing order if payment was confirmed.' });
  };
  app.use(errorHandler);

  return app;
}

export { prisma };
