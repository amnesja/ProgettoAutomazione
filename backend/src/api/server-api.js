import { createApiApp } from "./app.js";
import { env } from "../config/env.js";
const app = createApiApp({ serveFrontend: false });
app.listen(env.PORT, () => {
    console.log(`✅ HTTP API (frontend disabled) running on port ${env.PORT}`);
});
