import { createApp } from "./app.js";

const { app } = await createApp();
await app.listen({ port: 4102, host: "127.0.0.1" });
console.log(
  "Passage API ready at http://127.0.0.1:4102 (local durable worker).",
);
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
