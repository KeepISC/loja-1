import { requireDevelopment } from './config.js';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const prisma = new PrismaClient();

const categories = [
  {
    name: 'Electrónica',
    slug: 'electronica',
    description: 'Distribuidores de tecnologia, acessórios e soluções para negócios digitais.',
    priceCents: 1200,
    imageUrl: '/images/electronica.svg',
    active: true,
    contacts: [
      { supplierName: 'Nova Tech Supply', email: 'contato@novatech.example', telephone: '+351 210 111 001', whatsapp: '+351 910 111 001', website: 'https://novatech.example', notes: 'Entrega em 48h. Foco em acessórios e hardware.' },
      { supplierName: 'Nexus Commerce', email: 'sales@nexus.example', telephone: '+351 210 111 002', whatsapp: '+351 910 111 002', website: 'https://nexus.example', notes: 'Disponível para pedidos empresariais e gestão de stock.' },
    ],
  },
  {
    name: 'Moda',
    slug: 'moda',
    description: 'Fornecedores de roupas, acessórios e coleções sazonais para marcas locais.',
    priceCents: 980,
    imageUrl: '/images/moda.svg',
    active: true,
    contacts: [
      { supplierName: 'Luna Atelier', email: 'sales@lunaatelier.example', telephone: '+351 210 222 001', whatsapp: '+351 910 222 001', website: 'https://lunaatelier.example', notes: 'Especializada em peças premium e coleções editáveis.' },
      { supplierName: 'Veloura Retail', email: 'hello@veloura.example', telephone: '+351 210 222 002', whatsapp: '+351 910 222 002', website: 'https://veloura.example', notes: 'Foco em produção pequena escala e personalização.' },
    ],
  },
  {
    name: 'Perfumes',
    slug: 'perfumes',
    description: 'Listas de fornecedores de fragrâncias, amostras premium e kits de gifting.',
    priceCents: 1450,
    imageUrl: '/images/perfumes.svg',
    active: true,
    contacts: [
      { supplierName: 'Aroma Ideal', email: 'info@aromaideal.example', telephone: '+351 210 333 001', whatsapp: '+351 910 333 001', website: 'https://aromaideal.example', notes: 'Parcerias com marcas de nicho e edição limitada.' },
      { supplierName: 'Breeze Lab', email: 'team@breezelab.example', telephone: '+351 210 333 002', whatsapp: '+351 910 333 002', website: 'https://breezelab.example', notes: 'Amostras, kits de lançamento e identidades de marca.' },
    ],
  },
  {
    name: 'Relógios',
    slug: 'relogios',
    description: 'Contactos de relógios de luxo, acessórios premium e peças de colecção.',
    priceCents: 1800,
    imageUrl: '/images/relogios.svg',
    active: true,
    contacts: [
      { supplierName: 'Mare Time', email: 'support@maretime.example', telephone: '+351 210 444 001', whatsapp: '+351 910 444 001', website: 'https://maretime.example', notes: 'Relógios com foco em luxo e oferta institucional.' },
      { supplierName: 'Hora Claro', email: 'buyers@horaclaro.example', telephone: '+351 210 444 002', whatsapp: '+351 910 444 002', website: 'https://horaclaro.example', notes: 'Conselhos de preços e restocks para coleções premium.' },
    ],
  },
  {
    name: 'Desporto',
    slug: 'desporto',
    description: 'Fornecedores de equipamento, vestuário e merchandising para clubes e marcas.',
    priceCents: 1100,
    imageUrl: '/images/desporto.svg',
    active: true,
    contacts: [
      { supplierName: 'Pulse Active', email: 'hello@pulseactive.example', telephone: '+351 210 555 001', whatsapp: '+351 910 555 001', website: 'https://pulseactive.example', notes: 'Kit de treino e produtos para marcas de fitness.' },
      { supplierName: 'Velo & Co', email: 'supplier@velo.example', telephone: '+351 210 555 002', whatsapp: '+351 910 555 002', website: 'https://velo.example', notes: 'Especialização em bicicletas e acessórios de performance.' },
    ],
  },
  {
    name: 'Acessórios',
    slug: 'acessorios',
    description: 'Acessórios de marca, pequenos bens premium e itens utilitários para vendas online.',
    priceCents: 950,
    imageUrl: '/images/acessorios.svg',
    active: true,
    contacts: [
      { supplierName: 'Detalhe Plus', email: 'ops@detalheplus.example', telephone: '+351 210 666 001', whatsapp: '+351 910 666 001', website: 'https://detalheplus.example', notes: 'Reagendamento de encomendas e embalagens personalizadas.' },
      { supplierName: 'Mundo Mini', email: 'buyers@mundomini.example', telephone: '+351 210 666 002', whatsapp: '+351 910 666 002', website: 'https://mundomini.example', notes: 'Foco em acessórios de merchandising e promoções.' },
    ],
  },
];

export async function seedDatabase(prisma: PrismaClient) {
  requireDevelopment();
  await prisma.user.upsert({
    where: { email: 'admin@local.test' },
    update: {},
    create: {
      email: 'admin@local.test',
      role: 'ADMIN',
      displayName: 'Mock Administrator',
    },
  });

  await prisma.user.upsert({
    where: { email: 'guest@local.test' },
    update: {},
    create: {
      email: 'guest@local.test',
      role: 'GUEST',
      displayName: 'Mock Guest',
    },
  });

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        name: category.name,
        slug: category.slug,
        description: category.description,
        priceCents: category.priceCents,
        imageUrl: category.imageUrl,
        active: category.active,
        contacts: { create: category.contacts },
      },
    });
  }

  console.log('Seeded categories and mock accounts.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedDatabase(prisma).finally(() => prisma.$disconnect());
}
