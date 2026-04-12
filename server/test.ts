import { PrismaClient } from '@prisma/client';

try {
  const p1 = new PrismaClient();
  console.log("p1 ok");
} catch (e: any) {
  console.log("p1 failed:", e.message.split('\n')[0]);
}

try {
  const p2 = new (PrismaClient as any)({ datasources: { db: { url: "file:./dev.db" } } });
  console.log("p2 ok");
} catch (e: any) {
  console.log("p2 failed:", e.message.split('\n')[0]);
}

try {
  const p3 = new (PrismaClient as any)({ datasourceUrl: "file:./dev.db" });
  console.log("p3 ok");
} catch (e: any) {
  console.log("p3 failed:", e.message.split('\n')[0]);
}
