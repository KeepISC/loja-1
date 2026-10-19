-- Additive payment audit and Stripe lifecycle. Existing orders remain EUR and DUMMY.
ALTER TABLE `Order` ADD COLUMN `currency` VARCHAR(3) COLLATE utf8mb4_0900_bin NOT NULL DEFAULT 'EUR';
ALTER TABLE `Payment` ADD COLUMN `paymentIntentId` VARCHAR(255) COLLATE utf8mb4_0900_bin NULL, ADD COLUMN `refundedCents` INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX `Payment_paymentIntentId_key` ON `Payment` (`paymentIntentId`);
CREATE TABLE `PaymentAttempt` (
  `id` VARCHAR(36) NOT NULL,
  `paymentId` VARCHAR(36) NOT NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'CREATING',
  `sessionId` VARCHAR(255) NULL,
  `intentId` VARCHAR(255) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PaymentAttempt_sessionId_key` (`sessionId`),
  UNIQUE INDEX `PaymentAttempt_intentId_key` (`intentId`),
  INDEX `PaymentAttempt_paymentId_createdAt_idx` (`paymentId`, `createdAt`),
  CONSTRAINT `PaymentAttempt_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE TABLE `PaymentEvent` (
  `id` VARCHAR(36) NOT NULL,
  `paymentId` VARCHAR(36) NOT NULL,
  `eventId` VARCHAR(255) NULL,
  `kind` VARCHAR(80) NOT NULL,
  `status` VARCHAR(80) NOT NULL,
  `amountCents` INTEGER NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `actorId` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PaymentEvent_eventId_key` (`eventId`),
  INDEX `PaymentEvent_paymentId_createdAt_idx` (`paymentId`, `createdAt`),
  CONSTRAINT `PaymentEvent_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE TABLE `PaymentRefund` (
  `id` VARCHAR(36) NOT NULL,
  `paymentId` VARCHAR(36) NOT NULL,
  `providerRefundId` VARCHAR(255) NULL,
  `amountCents` INTEGER NOT NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'REQUESTED',
  `actorId` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `PaymentRefund_providerRefundId_key` (`providerRefundId`),
  INDEX `PaymentRefund_paymentId_createdAt_idx` (`paymentId`, `createdAt`),
  CONSTRAINT `PaymentRefund_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
