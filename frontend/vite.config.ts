import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Link previews (Open Graph) need absolute URLs, and the public address is known only when the
 * app is built for a server (VITE_PUBLIC_URL); without it the links stay relative.
 */
function absoluteSocialLinks(publicUrl: string): Plugin {
  const base = publicUrl.replace(/\/$/, "");
  return {
    name: "absolute-social-links",
    transformIndexHtml(html) {
      if (!/^https?:\/\/[^\s"'<>]+$/.test(base)) return html;
      return html
        .replace('content="/og.png"', `content="${base}/og.png"`)
        .replace('<meta property="og:type"', `<meta property="og:url" content="${base}/" />\n    <meta property="og:type"`);
    },
  };
}

/**
 * The assistant page's chunk (with the voice SDK) is the largest. On "/asistent" the browser
 * starts fetching it next to the main bundle instead of after it.
 */
function preloadConversation(): Plugin {
  return {
    name: "preload-conversation",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle ?? {}).find(
          (c) => c.type === "chunk" && c.facadeModuleId?.replace(/\\/g, "/").endsWith("/src/pages/Assistant.tsx"),
        );
        if (!chunk) return html;
        const href = JSON.stringify(`/${chunk.fileName}`);
        const script = `<script>if(location.pathname==="/asistent"){var l=document.createElement("link");l.rel="modulepreload";l.href=${href};document.head.appendChild(l)}</script>`;
        // Right after the charset: a script after the stylesheet would wait for it to load.
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${script}`);
      },
    },
  };
}

/**
 * Fonts load only when text needs them, and in this app text appears only after React renders,
 * so without a hint the headlines first show in a fallback font. The Latin subsets (latin-ext has
 * č, ć, đ, š, ž) download next to the scripts instead.
 */
function preloadFonts(): Plugin {
  const wanted = /\/schibsted-grotesk-latin(-ext)?-wght-normal-[\w-]+\.woff2$/;
  return {
    name: "preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const links = Object.values(ctx.bundle ?? {})
          .filter((a) => a.type === "asset" && wanted.test(`/${a.fileName}`))
          .map((a) => `<link rel="preload" href="/${a.fileName}" as="font" type="font/woff2" crossorigin />`);
        return links.length ? html.replace("</title>", `</title>\n    ${links.join("\n    ")}`) : html;
      },
    },
  };
}

// The repository's .env lives one level up and holds VITE_* variables for the frontend.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    absoluteSocialLinks(loadEnv(mode, "..", "VITE_").VITE_PUBLIC_URL ?? ""),
    preloadConversation(),
    preloadFonts(),
  ],
  envDir: "..",
  server: { port: 5173 },
  // The assistant page's chunk carries the voice SDK (ElevenLabs over LiveKit's WebRTC client,
  // about 640 kB, 170 kB gzipped). It is already split off by route and preloaded only on
  // "/asistent"; the SDK's hook runs at the top of that page, so it cannot be split further. Every
  // other chunk stays well under the default 500 kB, which this limit still guards.
  build: { chunkSizeWarningLimit: 700 },
}));
