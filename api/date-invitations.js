const express = require("express");
const router = express.Router();
const { db } = require("../configs/firebase");

// Middleware to check if Firebase is initialized
const checkFirebase = (req, res, next) => {
  if (!db) {
    return res.status(503).json({ 
      message: "Firebase is not configured. Please set up Firebase credentials." 
    });
  }
  next();
};

// GET /api/date-invitations - Fetch all date invitations
router.get("/", checkFirebase, async (req, res) => {
  try {
    const invitationsRef = db.ref("dateInvitations");
    const snapshot = await invitationsRef.once("value");
    const invitations = snapshot.val();

    if (!invitations) {
      return res.status(200).json([]);
    }

    // Convert Firebase object to array and sort by createdAt (newest first)
    const invitationsArray = Object.keys(invitations).map((key) => ({
      id: key,
      ...invitations[key],
    })).sort((a, b) => {
      const dateA = new Date(a.createdAt || 0);
      const dateB = new Date(b.createdAt || 0);
      return dateB - dateA;
    });

    res.status(200).json(invitationsArray);
  } catch (error) {
    console.error("Error fetching date invitations:", error);
    res.status(500).json({ 
      message: "Error fetching date invitations", 
      error: error.message 
    });
  }
});

// GET /api/date-invitations/:id - Fetch a specific invitation
router.get("/:id", checkFirebase, async (req, res) => {
  try {
    const { id } = req.params;
    const invitationRef = db.ref(`dateInvitations/${id}`);
    const snapshot = await invitationRef.once("value");
    const invitation = snapshot.val();

    if (!invitation) {
      return res.status(404).json({ message: "Invitation not found" });
    }

    res.status(200).json({ id, ...invitation });
  } catch (error) {
    console.error("Error fetching date invitation:", error);
    res.status(500).json({ 
      message: "Error fetching date invitation", 
      error: error.message 
    });
  }
});

// PUT /api/date-invitations/:id/rsvp - Update RSVP status
router.put("/:id/rsvp", checkFirebase, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rsvpMessage } = req.body;

    // Validate status
    if (!["accepted", "declined"].includes(status)) {
      return res.status(400).json({ 
        message: "Invalid status. Must be 'accepted' or 'declined'" 
      });
    }

    const invitationRef = db.ref(`dateInvitations/${id}`);
    const snapshot = await invitationRef.once("value");
    const invitation = snapshot.val();

    if (!invitation) {
      return res.status(404).json({ message: "Invitation not found" });
    }

    // Allow changing RSVP - update invitation
    const updates = {
      status: status,
      rsvpAt: new Date().toISOString(),
    };

    if (rsvpMessage && rsvpMessage.trim()) {
      updates.rsvpMessage = rsvpMessage.trim();
    }

    await invitationRef.update(updates);

    // Create notification for the invitation creator if available
    if (invitation.creatorUserId) {
      try {
        const notificationRef = db.ref(`users/${invitation.creatorUserId}/notifications`).push();
        // Get receiver name from receiver data if available
        let receiverName = "Your loved one";
        try {
          const receiverRef = db.ref(`users/${invitation.creatorUserId}/receiver`);
          const receiverSnapshot = await receiverRef.once("value");
          const receiverData = receiverSnapshot.val();
          if (receiverData && receiverData.name) {
            receiverName = receiverData.name;
          }
        } catch (receiverError) {
          console.log("Could not fetch receiver name, using default");
        }
        
        await notificationRef.set({
          type: "date_invitation_rsvp",
          invitationId: id,
          status,
          read: false,
          createdAt: new Date().toISOString(),
          date: invitation.date || "",
          time: invitation.time || "",
          location: invitation.location || "",
          receiverName: receiverName,
          rsvpMessage: rsvpMessage || null,
        });
      } catch (notifyError) {
        console.error("Error creating RSVP notification:", notifyError);
      }
    }

    res.status(200).json({ 
      message: "RSVP updated successfully",
      invitation: { id, ...invitation, ...updates }
    });
  } catch (error) {
    console.error("Error updating RSVP:", error);
    res.status(500).json({ 
      message: "Error updating RSVP", 
      error: error.message 
    });
  }
});

// POST /api/date-invitations - Create a new invitation (for admin/testing)
router.post("/", checkFirebase, async (req, res) => {
  try {
    const { date, time, location, message, googleMapsUrl, creatorUserId, creatorName } = req.body;

    if (!date || !time || !location) {
      return res.status(400).json({ 
        message: "Date, time, and location are required" 
      });
    }

    if (!creatorUserId) {
      return res.status(400).json({
        message: "creatorUserId is required"
      });
    }

    const newInvitation = {
      date,
      time,
      location,
      message: message || "",
      googleMapsUrl: googleMapsUrl || null,
      status: "pending",
      createdAt: new Date().toISOString(),
      creatorUserId,
      creatorName: creatorName || "Someone special"
    };

    const invitationsRef = db.ref("dateInvitations");
    const newInvitationRef = invitationsRef.push();
    await newInvitationRef.set(newInvitation);

    res.status(201).json({ 
      message: "Invitation created successfully",
      invitation: { id: newInvitationRef.key, ...newInvitation }
    });
  } catch (error) {
    console.error("Error creating invitation:", error);
    res.status(500).json({ 
      message: "Error creating invitation", 
      error: error.message 
    });
  }
});
// PUT /api/date-invitations/:id - Update an invitation
router.put("/:id", checkFirebase, async (req, res) => {
  try {
    const { id } = req.params;
    const { date, time, location, message, googleMapsUrl } = req.body;

    if (!date || !time || !location) {
      return res.status(400).json({
        message: "Date, time, and location are required",
      });
    }

    const invitationRef = db.ref(`dateInvitations/${id}`);
    const snapshot = await invitationRef.once("value");
    const invitation = snapshot.val();

    if (!invitation) {
      return res.status(404).json({ message: "Invitation not found" });
    }

    const updates = {
      date,
      time,
      location: location.trim(),
      message: message?.trim() || "",
      updatedAt: new Date().toISOString(),
    };

    // Update googleMapsUrl if provided
    if (googleMapsUrl !== undefined) {
      updates.googleMapsUrl = googleMapsUrl?.trim() || null;
    }

    await invitationRef.update(updates);

    res.status(200).json({
      message: "Invitation updated successfully",
      invitation: { id, ...invitation, ...updates },
    });
  } catch (error) {
    console.error("Error updating invitation:", error);
    res.status(500).json({
      message: "Error updating invitation",
      error: error.message,
    });
  }
});

// DELETE /api/date-invitations/:id - Delete an invitation
router.delete("/:id", checkFirebase, async (req, res) => {
  try {
    const { id } = req.params;
    const invitationRef = db.ref(`dateInvitations/${id}`);

    const snapshot = await invitationRef.once("value");
    if (!snapshot.exists()) {
      return res.status(404).json({ message: "Invitation not found" });
    }

    await invitationRef.remove();

    res.status(200).json({
      message: "Invitation deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting invitation:", error);
    res.status(500).json({
      message: "Error deleting invitation",
      error: error.message,
    });
  }
});

module.exports = router;


