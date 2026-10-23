/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // The WhatsApp AI agent embeds knowledge with @xenova/transformers, which
  // loads ONNX native bindings that break when bundled; require them at runtime.
  serverExternalPackages: ['@xenova/transformers', 'onnxruntime-node'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

export default nextConfig
