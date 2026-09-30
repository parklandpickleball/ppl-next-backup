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
      memberStatus,
      hasPartner,
      partnerName,
      partnerPhone,
      paymentChoice,
      paymentMethod,
      dueAmount,
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
Member Status: ${memberStatus || "N/A"}

Has Partner: ${hasPartner}
Partner Name: ${partnerName || "N/A"}
Partner Phone: ${partnerPhone || "N/A"}

Payment Choice: ${paymentChoice}
Payment Method: ${paymentMethod || "N/A"}
Amount Due: ${dueAmount || "N/A"}

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
      subject: `New PPL Registration — Paying via ${paymentMethod || "?"}`,
      text: emailContent,
    });

    // ✅ Confirmation email to the registrant themselves — best-effort, so a
    // problem here (e.g. a malformed email address) never blocks the admin
    // notification above or fails the whole request.
    if (email) {
      try {
        const firstName = String(fullName || "").trim().split(/\s+/)[0] || "there";

        const confirmationText = `Hi ${firstName},

You're officially registered for the Parkland Pickleball League, Season 6!

Division: ${division}
Amount Due: ${dueAmount || "N/A"}
Payment Method: ${paymentMethod || "N/A"}

If you haven't submitted payment yet, please do so to secure your spot — instructions are on the registration page. Questions? Just reply to this email or reach out to the League Commissioner.

See you on the courts!
Parkland Pickleball League`;

        await resend.emails.send({
          from: "noreply@parklandpb.com",
          to: [email],
          subject: "You're Registered — PPL Season 6",
          text: confirmationText,
        });
      } catch (confirmationError) {
        console.error("Confirmation email failed:", confirmationError);
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("ERROR:", error);

    return res.status(500).json({
      success: false,
      error: (error as any)?.message || "unknown error"
    });
  }
}