import { PrismaClient } from '@prisma/client';

try {
  const p4 = new (PrismaClient as any)({ datasource: { url: "file:./dev.db" } });
  console.log("p4 ok");
} catch (e: any) {
  console.log("p4 failed:", e.message.split('\n')[0]);
}

try {
  const p5 = new (PrismaClient as any)({ db: { url: "file:./dev.db" } });
  console.log("p5 ok");
} catch (e: any) {
  console.log("p5 failed:", e.message.split('\n')[0]);
}

try {
  const p6 = new (PrismaClient as any)({ url: "file:./dev.db" });
  console.log("p6 ok");
} catch (e: any) {
  console.log("p6 failed:", e.message.split('\n')[0]);
}
