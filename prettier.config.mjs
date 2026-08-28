/** @type {import("prettier").Config} */
const config = {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  // Sorts Tailwind classes into the canonical order so diffs stay small and
  // class strings don't drift into arbitrary orderings across files.
  plugins: ["prettier-plugin-tailwindcss"],
};

export default config;
