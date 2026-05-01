import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getContentTypeForPath, getUploadFilePath } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string[] }> },
) {
  try {
    const { slug } = await context.params;
    const filePath = getUploadFilePath(slug);
    const buffer = await readFile(filePath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": getContentTypeForPath(filePath),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
