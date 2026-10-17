import app from "@/server/app";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return app.fetch(request);
}

export function HEAD(request: Request): Promise<Response> {
  return app.fetch(request);
}

export function POST(request: Request): Promise<Response> {
  return app.fetch(request);
}

export function PUT(request: Request): Promise<Response> {
  return app.fetch(request);
}

export function DELETE(request: Request): Promise<Response> {
  return app.fetch(request);
}

export function OPTIONS(request: Request): Promise<Response> {
  return app.fetch(request);
}
