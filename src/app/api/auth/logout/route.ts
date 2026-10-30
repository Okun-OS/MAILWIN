import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { destroySession } from "@/lib/auth/session";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(appUrl("/login"), 303);
}
