// Runs before rendering; external file is compatible with script-src 'self'.
try {
  document.documentElement.setAttribute("data-theme", localStorage.getItem("bp-theme") === "light" ? "light" : "dark");
} catch (e) {
  document.documentElement.setAttribute("data-theme", "dark");
}
