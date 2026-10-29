import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { integrations } from "@/lib/env";
import { MarvinPointing } from "@/components/Marvin";
import { ProjectStartForm } from "@/components/ProjectStartForm";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Neues Projekt" };
export const maxDuration = 300;

/** Projektstart als Gespräch statt Formular: Bürohintergrund + Marvin als Figur + Eingabe. */
export default async function NewProjectPage() {
  await requireUser();
  return (
    <>
      <div className="page-title">
        <div>
          <Link href="/projekte" className="link-more"><Icon name="chevronLeft" size={14} /> Projekte</Link>
          <h1 style={{ marginTop: 6 }}>Neues Projekt starten</h1>
        </div>
      </div>
      <section className="project-stage">
        <div className="bg">
          <Image src="/brand/buero-hintergrund.webp" alt="" fill priority sizes="100vw" />
        </div>
        <div className="figure">
          <MarvinPointing width={430} priority />
        </div>
        <div className="panel">
          <div className="speech">
            <b>Was möchtest du als Nächstes erreichen?</b>
            <br />
            Beschreib mir dein Vorhaben – wir planen gemeinsam die nächsten Schritte. Ich frage nach, wo etwas fehlt, recherchiere Zuständigkeiten und bereite die nötigen E-Mails vor.
          </div>
          {integrations.marvin ? <ProjectStartForm /> : <div className="notice warn">Marvin ist auf diesem Server noch nicht eingerichtet (ANTHROPIC_API_KEY fehlt).</div>}
        </div>
      </section>
    </>
  );
}
