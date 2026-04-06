import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        day: { 1: "#1D9E75", 2: "#378ADD", 3: "#5DCAA5", 4: "#7F77DD", 5: "#D85A30", 6: "#D4537E", 7: "#EF9F27" },
        family: { charles: "#5DCAA5", member2: "#85B7EB", member3: "#ED93B1", member4: "#F0997B", member5: "#AFA9EC" },
      },
    },
  },
  plugins: [],
};
export default config;
