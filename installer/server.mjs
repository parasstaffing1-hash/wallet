import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "site");
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function fileForRequest(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return candidate;
}

async function readPage(candidate) {
  try {
    return { file: candidate, data: await fs.readFile(candidate) };
  } catch {
    if (path.extname(candidate)) {
      return null;
    }
    try {
      const htmlFile = `${candidate}.html`;
      return { file: htmlFile, data: await fs.readFile(htmlFile) };
    } catch {
      return null;
    }
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let candidate;
  try {
    candidate = fileForRequest(request.url || "/");
  } catch {
    candidate = null;
  }
  if (!candidate) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const page = await readPage(candidate);
  if (!page) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = path.extname(page.file).toLowerCase();
  response.writeHead(200, {
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Length": page.data.byteLength,
    "Content-Type": contentTypes[extension] || "application/octet-stream",
  });
  if (request.method === "HEAD") {
    response.end();
  } else {
    response.end(page.data);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Wallet is running at http://127.0.0.1:${port}/`);
});

export { server };
