// Colours match the Ladder web design (dark teal headings, green accent).
export function otpEmail(code: string, expiresInSeconds: number) {
  const minutes = Math.round(expiresInSeconds / 60);

  return {
    subject: `Your Ladder Login verification code`,
    text: [
      `Your Ladder verification code is ${code}.`,
      `It expires in ${minutes} minutes.`,
      'If you did not try to create a Ladder account, you can ignore this email. Never share this code with anyone.',
    ].join('\n\n'),
    html: `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;color:#1e3a44;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;">
      <tr>
        <td style="padding:32px;">
          <p style="margin:0 0 24px;font-size:24px;font-weight:bold;color:#1e3a44;">Ladder</p>
          <p style="margin:0 0 8px;font-size:18px;font-weight:bold;">Verify your email</p>
          <p style="margin:0 0 24px;font-size:14px;color:#6b8290;">Enter this code to continue creating your account.</p>
          <p style="margin:0 0 24px;padding:16px;background:#e9f6f1;border-radius:12px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:8px;color:#1e3a44;">${code}</p>
          <p style="margin:0 0 8px;font-size:13px;color:#6b8290;">This code expires in ${minutes} minutes.</p>
          <p style="margin:0;font-size:13px;color:#6b8290;">If you did not try to create a Ladder account, ignore this email. Never share this code with anyone.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
