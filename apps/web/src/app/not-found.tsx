import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="wrap">
      <section className="view on">
        <h1>Page not found</h1>
        <p className="lede">That page does not exist.</p>
        <p style={{ marginTop: 22 }}>
          <Link className="sbtn" href="/" style={{ textDecoration: 'none' }}>
            Back to the games
          </Link>
        </p>
      </section>
    </main>
  );
}
