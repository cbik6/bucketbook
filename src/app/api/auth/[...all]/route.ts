import { getAuth } from "@/server/auth/auth";

// Better Auth handles /api/auth/* (sign in, sign out, session).
export async function GET(request: Request) {
  return getAuth().handler(request);
}

export async function POST(request: Request) {
  return getAuth().handler(request);
}
