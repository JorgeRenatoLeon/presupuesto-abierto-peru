/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // GitHub Pages serves project sites under /<repo>/; CI sets BASE_PATH from actions/configure-pages
  basePath: process.env.BASE_PATH || "",
};

export default nextConfig;
