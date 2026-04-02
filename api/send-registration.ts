import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY is missing");
}

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false });
  }

  try {
    const {
      fullName,
      email,
      phoneNumber,
      division,
      hasPartner,
      partnerName,
      partnerPhone,
      paymentChoice,
      waiverAccepted,
      waiverAcceptedAt,
      waiverText,
    } = req.body;

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

Waiver Accepted: ${waiverAccepted ? "YES" : "NO"}
Waiver Accepted At: ${waiverAcceptedAt || "N/A"}

--- WAIVER CONTENT AGREED TO ---

${waiverText || "N/A"}

--------------------------------
`;

    await resend.emails.send({
      from: "noreply@parklandpb.com",
      to: [
        "parklandpickleballleague@gmail.com",
        "brandon.reich@yahoo.com"
      ],
      subject: "New PPL Registration",
      text: emailContent,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("ERROR:", error);

    return res.status(500).json({
      success: false,
      error: (error as any)?.message || "unknown error"
    });
  }
}