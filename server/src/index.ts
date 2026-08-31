import express from "express";
import cors from "cors";
import agentRouter from "./routes/agent";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ],
  credentials: false,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Session-ID"],
}));

app.use(express.json({ limit: "500kb" }));
app.use(express.urlencoded({ extended: true, limit: "500kb" }));

app.use("/api/agent", agentRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[SERVER ERROR]", err);
  res.status(500).json({ error: "Internal server error" });
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[Veil Server] Running on http://${HOST}:${PORT}`);
  console.log(`[Veil Server] Agent endpoint: POST http://${HOST}:${PORT}/api/agent/plan`);
  console.log(`[Veil Server] Health check: GET http://${HOST}:${PORT}/health`);
});

process.on("SIGTERM", () => {
  console.log("[Veil Server] SIGTERM received, shutting down...");
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("[Veil Server] SIGINT received, shutting down...");
  server.close(() => {
    process.exit(0);
  });
});

export { app };