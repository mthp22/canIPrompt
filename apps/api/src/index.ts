import { app } from "./app";

const port = Number(process.env.PORT || 3000);

app.listen(port);

console.log(
  `CanIPrompt API running at http://localhost:${app.server?.port}`
);
