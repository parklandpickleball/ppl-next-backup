import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      fullName,
      email,
      phoneNumber,
      division,
      hasPartner,
      partnerName,
      partnerPhone,
      paymentChoice,
    } = body;

    const emailContent = `
New Registration:

Name: ${fullName}
Email: ${email}
Phone: ${phoneNumber}
Division: ${division}

Has Partner: ${hasPartner}
Partner Name: ${partnerName || "N/A"}
Partner Phone: ${partnerPhone || "N/A"}

Payment Choice: ${paymentChoice}
`;

    await resend.emails.send({
      from: "PPL Registration <onboarding@resend.dev>",
      to: ["parklandpickleballleague@gmail.com"],
      subject: "New PPL Registration",
      text: emailContent,
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ success: false }), { status: 500 });
  }
}