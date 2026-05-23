import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        damm: {
          red: "#e3122e",
          dark: "#0b0f17",
          slate: "#121826",
          panel: "#161d2e",
          ink: "#e6ebf5",
          muted: "#8a93a8",
          accent: "#4ea3ff",
          ok: "#28c76f",
          warn: "#f6b93b",
          bad: "#ff5c5c",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(78,163,255,0.4), 0 8px 32px rgba(78,163,255,0.18)",
        red: "0 0 0 1px rgba(227,18,46,0.5), 0 8px 32px rgba(227,18,46,0.2)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "ui-sans-serif", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
