import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";

import App from "./App";
import { AppPreferencesProvider } from "./lib/app-preferences";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <AppPreferencesProvider>
        <App />
      </AppPreferencesProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
