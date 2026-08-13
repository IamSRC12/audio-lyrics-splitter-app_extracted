export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    groqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
    maxUploadMb: 50,
  });
}
