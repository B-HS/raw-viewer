import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        viewport: "#3C3C3C",
      },
    },
  },
  plugins: [],
};

export default config;
