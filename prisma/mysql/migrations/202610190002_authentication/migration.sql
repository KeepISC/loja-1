-- AlterTable
ALTER TABLE `SupplierContact` ADD COLUMN `supplierId` VARCHAR(128) NULL;

-- CreateTable
CREATE TABLE `Account` (
    `userId` VARCHAR(128) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `emailVerifiedAt` DATETIME(3) NULL,
    `sessionVersion` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`userId`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- CreateTable
CREATE TABLE `AuthToken` (
    `idHash` CHAR(64) NOT NULL,
    `userId` VARCHAR(128) NOT NULL,
    `purpose` VARCHAR(20) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,

    INDEX `AuthToken_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `AuthToken_userId_purpose_key`(`userId`, `purpose`),
    PRIMARY KEY (`idHash`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- CreateTable
CREATE TABLE `AuthEmail` (
    `id` VARCHAR(128) NOT NULL,
    `userId` VARCHAR(128) NOT NULL,
    `recipient` VARCHAR(254) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuthEmail_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- CreateTable
CREATE TABLE `AuthRateLimit` (
    `keyHash` CHAR(64) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `AuthRateLimit_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`keyHash`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- CreateTable
CREATE TABLE `SupplierProfile` (
    `userId` VARCHAR(128) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`userId`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;

-- CreateIndex
CREATE INDEX `SupplierContact_supplierId_idx` ON `SupplierContact`(`supplierId`);

-- AddForeignKey
ALTER TABLE `Account` ADD CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthToken` ADD CONSTRAINT `AuthToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `Account`(`userId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuthEmail` ADD CONSTRAINT `AuthEmail_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `Account`(`userId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierProfile` ADD CONSTRAINT `SupplierProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupplierContact` ADD CONSTRAINT `SupplierContact_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `SupplierProfile`(`userId`) ON DELETE SET NULL ON UPDATE CASCADE;
