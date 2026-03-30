// api/subscribe.js
// Vercel Serverless Function — Framer Form → Klaviyo List

const KLAVIYO_API_KEY = process.env.KLAVIYO_PRIVATE_KEY;
const KLAVIYO_LIST_ID = process.env.KLAVIYO_LIST_ID;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Set CORS headers for all responses
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Framer webhook sends keys matching input Name fields
    const email = req.body.Email || req.body.email;
    const firstName = req.body.FirstName || req.body.firstName || req.body.Name || req.body.name;
    const message = req.body.Message || req.body.message;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Step 1: Create or update the profile in Klaviyo
    const profileAttributes = {
      email: email,
      first_name: firstName || "",
    };

    // Store message as a custom property on the profile
    if (message) {
      profileAttributes.properties = {
        "Contact Form Message": message,
        "Last Contact Date": new Date().toISOString(),
      };
    }

    const profileRes = await fetch("https://a.klaviyo.com/api/profiles/", {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
        "Content-Type": "application/json",
        revision: "2024-10-15",
      },
      body: JSON.stringify({
        data: {
          type: "profile",
          attributes: profileAttributes,
        },
      }),
    });

    let profileId;

    if (profileRes.status === 201) {
      // New profile created
      const profileData = await profileRes.json();
      profileId = profileData.data.id;
    } else if (profileRes.status === 409) {
      // Profile already exists — extract ID from the duplicate error
      const errorData = await profileRes.json();
      const meta = errorData.errors?.[0]?.meta?.duplicate_profile_id;
      if (meta) {
        profileId = meta;
      } else {
        // Fallback: search for the profile by email
        const searchRes = await fetch(
          `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${encodeURIComponent(email)}")`,
          {
            headers: {
              Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
              revision: "2024-10-15",
            },
          }
        );
        const searchData = await searchRes.json();
        profileId = searchData.data?.[0]?.id;
      }
    } else {
      const errText = await profileRes.text();
      console.error("Klaviyo profile error:", errText);
      return res.status(500).json({ error: "Failed to create profile" });
    }

    if (!profileId) {
      return res.status(500).json({ error: "Could not resolve profile ID" });
    }

    // Step 2: Add the profile to the list
    const listRes = await fetch(
      `https://a.klaviyo.com/api/lists/${KLAVIYO_LIST_ID}/relationships/profiles/`,
      {
        method: "POST",
        headers: {
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          "Content-Type": "application/json",
          revision: "2024-10-15",
        },
        body: JSON.stringify({
          data: [
            {
              type: "profile",
              id: profileId,
            },
          ],
        }),
      }
    );

    if (listRes.status === 204 || listRes.status === 200) {
      return res.status(200).json({ success: true, message: "Subscribed!" });
    } else {
      const listErr = await listRes.text();
      console.error("Klaviyo list error:", listErr);
      return res.status(500).json({ error: "Failed to add to list" });
    }
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
