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
        // A hairline; firmer when the device asks for more contrast (index.css).
        line: "rgb(var(--cv-ink) / var(--cv-line-alpha, 0.09))",
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
        // The curves of index.css as classes: ease-cv for what enters or
        // answers a press, ease-cv-move for what changes place on screen,
        // ease-cv-drawer for sheets.
        cv: "cubic-bezier(0.23, 1, 0.32, 1)",
        "cv-move": "cubic-bezier(0.77, 0, 0.175, 1)",
        "cv-drawer": "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    typography,
  ],
}
