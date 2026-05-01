import { createApiApp } from "./app.js";
import { env } from "../config/env.js";

const app = createApiApp({ serveFrontend: env.SERVE_FRONTEND });

app.listen(env.PORT, () => {
  console.log(`✅ HTTP API running on port ${env.PORT} (frontend ${env.SERVE_FRONTEND ? "enabled" : "disabled"})`);
});
