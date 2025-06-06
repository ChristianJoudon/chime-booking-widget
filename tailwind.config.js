/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        // Tell Tailwind where to look for class names:
        "./index.html",
        "./src/**/*.{js,jsx,ts,tsx}"
    ],
    theme: {
        extend: {
            colors: {
                // Our mint palette:
                mint: {
                    100: "#d9f5eb",
                    200: "#A8E6CF",
                    300: "#88D9BF",
                },
                "mint-dark": "#94D2BB",
            },
            fontFamily: {
                // Rounded sans-serif:
                sans: ["Plus Jakarta Sans", "Inter", "sans-serif"]
            },
            backdropBlur: {
                // Optional extra blur size if you want it:
                xs: "2px",
            }
        },
    },
    plugins: [
        // If you want to style form inputs nicely:
        require("@tailwindcss/forms"),
    ],
};