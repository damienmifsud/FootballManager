import DevBanner from "@/components/DevBanner";
import { isDevSite } from "@/lib/siteEnv";

export const metadata = {
  title: isDevSite() ? "Dev · Team Dashboard" : "Team Dashboard",
  description: "Fixtures, results, training, duties and stats."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body style={{ margin: 0, background: "#F4F4F3" }}><DevBanner />{children}</body>
    </html>
  );
}
