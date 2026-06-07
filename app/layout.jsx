export const metadata = {
  title: "Team Dashboard",
  description: "Fixtures, results, training, duties and stats."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body style={{ margin: 0, background: "#F3F5F1" }}>{children}</body>
    </html>
  );
}
