import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // Hover styles only where a pointer can hover: on a phone a tapped element
  // would otherwise keep its hover look until the next tap.
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        // One neutral ramp, three text roles and one accent. The values live
        // in index.css (:root), as RGB channels so that opacity modifiers work.
        page: "rgb(var(--cv-page) / <alpha-value>)",
        card: "rgb(var(--cv-card) / <alpha-value>)",
        raised: "rgb(var(--cv-raised) / <alpha-value>)",
        line: "rgb(var(--cv-ink) / 0.09)",
        ink: {
          DEFAULT: "rgb(var(--cv-ink) / <alpha-value>)",
          2: "rgb(var(--cv-ink-2) / <alpha-value>)",
          3: "rgb(var(--cv-ink-3) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--cv-accent) / <alpha-value>)",
          ink: "rgb(var(--cv-accent-ink) / <alpha-value>)",
        },
      },
      transitionTimingFunction: {
        // The one curve for everything that moves.
        cv: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeOut: {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-4px)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.25s ease-out",
        fadeOut: "fadeOut 0.25s ease-in forwards",
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    typography,
  ],
}
