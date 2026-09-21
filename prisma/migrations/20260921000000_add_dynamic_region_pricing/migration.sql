CREATE TABLE "RegionPricing" (
    "id" SERIAL NOT NULL,
    "region" TEXT NOT NULL,
    "price12x18" INTEGER NOT NULL,
    "price12x24" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegionPricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegionPricing_region_key" ON "RegionPricing"("region");
CREATE INDEX "RegionPricing_sortOrder_id_idx" ON "RegionPricing"("sortOrder", "id");

INSERT INTO "RegionPricing" ("region", "price12x18", "price12x24", "sortOrder", "updatedAt")
VALUES
    ('Odisha/West Bengal', 170, 210, 0, CURRENT_TIMESTAMP),
    ('Rajasthan', 165, 210, 1, CURRENT_TIMESTAMP),
    ('Delhi/Punjab/Haryana', 160, 200, 2, CURRENT_TIMESTAMP);
