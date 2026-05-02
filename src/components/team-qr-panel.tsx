/* eslint-disable @next/next/no-img-element */

"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import type { Team } from "@/lib/tournament";

interface TeamQrPanelProps {
  team: Team | null;
  publicBaseUrl: string;
}

function playerName(name: string, index: number): string {
  return name.trim() || `Jugador ${index + 1}`;
}

export function TeamQrPanel({ team, publicBaseUrl }: TeamQrPanelProps) {
  const [qrCache, setQrCache] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const joinUrl = useMemo(() => {
    if (!team) {
      return "";
    }

    const browserOrigin =
      typeof window !== "undefined" ? window.location.origin : "";
    const baseUrl = publicBaseUrl.trim() || browserOrigin;
    return `${baseUrl.replace(/\/+$/, "")}/join/${team.id}`;
  }, [publicBaseUrl, team]);

  useEffect(() => {
    if (!joinUrl || qrCache[joinUrl]) {
      return;
    }

    void QRCode.toDataURL(joinUrl, {
      width: 380,
      margin: 1,
      color: {
        dark: "#10160f",
        light: "#f4f7ef",
      },
    }).then((generatedQr) => {
      setQrCache((current) =>
        current[joinUrl] ? current : { ...current, [joinUrl]: generatedQr },
      );
    });
  }, [joinUrl, qrCache]);

  async function handleCopy(): Promise<void> {
    if (!joinUrl) {
      return;
    }

    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (!team) {
    return (
      <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-5 shadow-[0_25px_80px_rgba(0,0,0,0.2)]">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--accent)]">
          QR del equipo
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-5 shadow-[0_25px_80px_rgba(0,0,0,0.2)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--accent)]">
              Acceso móvil
            </p>
            <InfoHint label="Cada integrante escanea este QR para abrir su acceso de equipo desde el móvil." />
          </div>
          <h3 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
            {team.name}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="button-secondary"
        >
          {copied ? "Copiado" : "Copiar enlace"}
        </button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
          {qrCache[joinUrl] ? (
            <img
              src={qrCache[joinUrl]}
              alt={`QR para ${team.name}`}
              className="aspect-square w-full rounded-[8px] border border-[var(--stroke)] bg-[#f4f7ef] object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-[8px] border border-dashed border-[var(--stroke)] bg-[#f4f7ef] text-sm text-[var(--muted-soft)]">
              Generando QR...
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Jugadores
            </p>
            <div className="mt-4 space-y-3">
              {team.players.map((player, index) => (
                <div
                  key={player.id}
                  className="flex items-center gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-3"
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)] text-sm font-semibold text-[var(--foreground)]">
                    {player.photoUrl ? (
                      <img
                        src={player.photoUrl}
                        alt={playerName(player.name, index)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span>{player.slot}</span>
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-[var(--foreground)]">
                      {playerName(player.name, index)}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {player.photoUrl ? "Foto subida" : "Pendiente de selfie"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Enlace
            </p>
            <p className="mt-3 break-all font-mono text-sm leading-6 text-[var(--muted)]">
              {joinUrl || "Define una URL pública o abre la app en tu navegador."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
