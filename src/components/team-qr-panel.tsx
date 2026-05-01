/* eslint-disable @next/next/no-img-element */

"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
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
        dark: "#0e1726",
        light: "#eff7ff",
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
      <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_25px_80px_rgba(0,0,0,0.2)] backdrop-blur">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77cfff]">
          QR del equipo
        </p>
        <p className="mt-3 text-sm text-white/62">
          Selecciona un equipo para generar su acceso móvil.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_25px_80px_rgba(0,0,0,0.2)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77cfff]">
            Acceso móvil
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-white">
            {team.name}
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-white/62">
            Cada integrante puede escanear este QR desde cualquier móvil y subir su
            selfie o una foto desde la cámara.
          </p>
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
        <div className="rounded-[26px] border border-white/10 bg-[#0b1320] p-4">
          {qrCache[joinUrl] ? (
            <img
              src={qrCache[joinUrl]}
              alt={`QR para ${team.name}`}
              className="aspect-square w-full rounded-[20px] border border-white/10 bg-[#eff7ff] object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-[20px] border border-dashed border-white/14 bg-[#eff7ff] text-sm text-slate-500">
              Generando QR...
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[24px] border border-white/10 bg-[#0b1320] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
              Jugadores
            </p>
            <div className="mt-4 space-y-3">
              {team.players.map((player, index) => (
                <div
                  key={player.id}
                  className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#11253d] text-sm font-semibold text-white">
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
                    <p className="font-medium text-white">
                      {playerName(player.name, index)}
                    </p>
                    <p className="text-sm text-white/52">
                      {player.photoUrl ? "Foto subida" : "Pendiente de selfie"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-[#0b1320] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
              Enlace
            </p>
            <p className="mt-3 break-all text-sm leading-6 text-white/74">
              {joinUrl || "Define una URL pública o abre la app en tu navegador."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
