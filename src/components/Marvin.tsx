import Image from "next/image";

/** Offizielles Marvin-Icon (frontal) – überall, wo Marvin spricht oder arbeitet. */
export function MarvinIcon({ size = 36, className }: { size?: number; className?: string }) {
  return <Image src="/brand/marvin-icon.webp" alt="Marvin" width={size} height={size} className={className} style={{ flex: "none" }} />;
}

/** Marvin als zeigende Figur – für Begrüßung, Projektstart und Assistenten. Seitenverhältnis 1284×1225. */
export function MarvinPointing({ width = 360, className, priority }: { width?: number; className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/marvin-zeigend.webp"
      alt="Marvin zeigt auf den Inhalt"
      width={width}
      height={Math.round((width * 1225) / 1284)}
      className={className}
      priority={priority}
      style={{ height: "auto", maxWidth: "100%" }}
    />
  );
}
