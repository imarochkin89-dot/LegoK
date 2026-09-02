import ShareView from "./share-view";

export const metadata = { robots: { index: false, follow: false, nocache: true } };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareView token={token} />;
}
