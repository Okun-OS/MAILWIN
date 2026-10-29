import Image from "next/image";
import Link from "next/link";

interface HeroProps {
  dateLabel: string;
  greeting: { title: string; text: string };
  tiles: { href: string; value: string; label: string; ariaLabel: string }[];
}

/**
 * „Heute im Blick“: Das bereitgestellte Header-Motiv ist der Bild-Layer.
 * Begrüßung und Kennzahlen sind echte HTML-Elemente über der leeren Sprechblase bzw. den Symbolkacheln.
 */
export function Hero({ dateLabel, greeting, tiles }: HeroProps) {
  return (
    <section className="hero" aria-label="Heute im Blick">
      <Image src="/brand/hero-heute-im-blick.webp" alt="" fill priority sizes="(max-width: 1100px) 100vw, 66vw" />
      <div className="hero-bubble" aria-live="polite">
        <span className="eyebrow">Heute im Blick · {dateLabel}</span>
        <h1>
          <span>{greeting.title}</span>
        </h1>
        <p>{greeting.text}</p>
      </div>
      <div className="hero-tiles">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="hero-tile" aria-label={t.ariaLabel}>
            <span className="val">
              <b>{t.value}</b>
              <small>{t.label}</small>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
