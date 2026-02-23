import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView,
  Text,
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  Platform,
  Image,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../constants/supabaseClient";


const LOGO = require("../assets/images/icon.png");
const HERO_BG = require("../assets/images/hero.jpg");

const HEADER_OFFSET = 90;

export default function Home() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  // ✅ store measured Y positions for each section
  const [sectionY, setSectionY] = useState<Record<string, number>>({});
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
const [galleryLoading, setGalleryLoading] = useState(true);
const galleryPreview = galleryUrls.slice(0, 4);
const [galleryOpen, setGalleryOpen] = useState(false);
const [galleryIndex, setGalleryIndex] = useState(0);
const [galleryMode, setGalleryMode] = useState<"gallery" | "commissioners">("gallery");
const openGalleryAt = (i: number) => { setGalleryMode("gallery"); setGalleryIndex(i); setGalleryOpen(true); };


  if (Platform.OS !== "web") return null;
  useEffect(() => {
  let alive = true;

  const loadGallery = async () => {
    try {
      setGalleryLoading(true);

      const BUCKET = "website_gallery";

      let { data, error } = await supabase.storage.from(BUCKET).list(".", {
        limit: 100,
        offset: 0,
        sortBy: { column: "name", order: "asc" },
      });

      // fallback for older behavior
if ((!data || data.length === 0) && !error) {
  const res = await supabase.storage.from(BUCKET).list("", {
    limit: 100,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  });
  data = res.data as any;
  error = res.error as any;
}

      if (error) throw error;

      const files = (data || [])
  .filter((f) => !!f.name && !f.name.startsWith("."))
  .map((f) => f.name);

const signed: string[] = [];
for (const name of files) {
  const { data: s, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(name, 60 * 60);
  if (!sErr && s?.signedUrl) signed.push(s.signedUrl);
}

const urls = signed;


      if (alive) setGalleryUrls(urls);
      console.log("GALLERY URL ORDER:", urls);

    } catch {
      if (alive) setGalleryUrls([]);
    } finally {
      if (alive) setGalleryLoading(false);
    }
  };

  loadGallery();
  return () => {
    alive = false;
  };
}, []);


  const goPortal = () => router.push("/league-lock");

  const onSectionLayout = (key: string, y: number) => {
    setSectionY((prev) => {
      // avoid re-setting constantly
      if (prev[key] === y) return prev;
      return { ...prev, [key]: y };
    });
  };

 const scrollTo = (key: string) => {
    const el = document.getElementById(key);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "start" });

    window.setTimeout(() => {
      window.scrollBy({ top: -HEADER_OFFSET, left: 0, behavior: "auto" });
    }, 60);

    (document.activeElement as HTMLElement | null)?.blur?.();
  };


  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.bg} />

      {/* ✅ ScrollView now wraps EVERYTHING (including hero) so wheel works anywhere */}
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.page}>
        {/* HERO (full-bleed) */}
        <View style={styles.hero}>
          <View style={styles.heroBg}>
            <Image source={HERO_BG} resizeMode="cover" style={styles.heroImg} />

            {/* vignette */}
            <View style={styles.heroVignette} />

            {/* top nav (center links, keep member portal far-right) */}
            <View style={styles.heroTopNav}>
              <View style={styles.heroTopInner}>
                <Image source={LOGO} style={styles.topLogo} resizeMode="contain" />

                {/* center slot */}
                <View style={styles.topLinksSlot}>
                  <View style={styles.topLinks}>
                    <TopLink label="LEAGUE INFORMATION" onPress={() => scrollTo("league-info")} />
                    <TopLink label="MEMBERSHIP" onPress={() => scrollTo("membership")} />
                    <TopLink label="GALLERY" onPress={() => scrollTo("gallery")} />
                    <TopLink label="SPONSORS" onPress={() => scrollTo("sponsors")} />
                    <TopLink label="CONTACT" onPress={() => scrollTo("contact")} />
                  </View>
                </View>

                <Pressable onPress={goPortal} style={styles.memberLoginBtn}>
                  <Text style={styles.memberLoginText}>MEMBER PORTAL</Text>
                </Pressable>
              </View>
            </View>

            {/* premium card sitting over hero bottom (STARTING POINT) */}
            <View style={styles.heroCardOuter}>
              <View style={styles.heroCard}>
                <View style={styles.heroCardTopRow}>
                  <Text style={styles.heroCardKicker}>PARKLAND • FLORIDA</Text>
                </View>

                <Text style={styles.heroCardTitle}>Parkland Pickleball League</Text>

                <Text style={styles.heroCardBody}>
                  The Parkland Pickleball League is built on competitive excellence, sportsmanship, and a strong sense
                  of community. Each season operates with structured match scheduling, live standings and results, and a
                  fully integrated league portal designed for transparency and performance tracking. With high standards
                  of play and meaningful season-long competition, every match contributes to a larger competitive
                  narrative.
                </Text>

                <View style={styles.heroCardDivider} />

                <View style={styles.heroMiniRow}>
                  <MiniStat label="Schedules" value="Live" />
                  <MiniStat label="Standings" value="Live" />
                  <MiniStat label="Results" value="Live" />
                  <MiniStat label="Photos" value="Live" />
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* spacer for overlapping card */}
        <View style={{ height: 320 }} />

        {/* PREMIUM LOWER-HALF WRAPPER */}
        <View style={styles.lowerWrap}>
          {/* LEAGUE INFO */}
          <View
            nativeID="league-info"
            id="league-info"
            onLayout={(e) => onSectionLayout("league-info", e.nativeEvent.layout.y)}
            style={styles.sectionBand}
          >
            <View style={styles.container}>
              {/* ✅ League Info uses the same card style + forced shadow via extra style */}
              <View style={styles.heroCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>League Information</Text>
                  <Text style={styles.sectionBody}>
                    Parkland Pickleball League is a structured, competitive league founded on sportsmanship and
                    community.
                  </Text>

                  <Text style={styles.sectionBody}>
                    The league features three divisions designed to support competitive play at multiple levels. Both men
                    and women participate, with mixed and unisex teams welcomed across all divisions.
                  </Text>

                  <Text style={styles.sectionBody}>
                    League matches are presently held on Monday evenings at the Country Club of Coral Springs while the
                    new Parkland courts are under development.
                  </Text>
                </View>

                <View style={styles.cardRow}>
                  <InfoCard
                    title="Divisions"
                    body="Beginner · Intermediate · Advanced  Structured levels supporting competitive progression."
                  />
                  <InfoCard
                    title="Match Schedule"
                    body="Structured Monday evening match windows from 5:30 PM through 9:00 PM."
                  />
                  <InfoCard
                    title="Venue"
                    body="Hosted at the Country Club of Coral Springs while the new Parkland courts are under development."
                  />
                  <InfoCard
                    title="Growth"
                    body="Three divisions today — with structured expansion planned for future seasons."
                  />
                  <InfoCard
                    title="Season Portal"
                    body="Live schedules, standings, results, announcements, and photos via our custom app"
                  />
                  <InfoCard
                    title="League Culture"
                    body="Competitive, organized play built on sportsmanship and community."
                  />
                </View>
              </View>
            </View>
          </View>

          {/* MEMBERSHIP */}
          <View
            nativeID="membership"
            id="membership"
            onLayout={(e) => onSectionLayout("membership", e.nativeEvent.layout.y)}
            style={styles.sectionBand}
          >
            <View style={styles.container}>
  <View style={styles.heroCard}>
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>Membership</Text>
      <Text style={styles.sectionBody}>
        Ready to join? Membership is offered on a seasonal basis and structured by division to preserve
        competitive integrity and league standards. Official registration details and key dates will be
        published here prior to each season. For membership inquiries, please contact the League Commissioner
        using the contact link below.
      </Text>
    </View>


              {/* Contact Card */}
              <Pressable
                onPress={() =>
                  (window.location.href =
                    "mailto:parklandpickleballleague@gmail.com?subject=Membership%20Inquiry%20-%20Parkland%20Pickleball%20League")
                }
                style={styles.membershipCard}
              >
                <Text style={styles.membershipCardAction}>Contact the League Commissioner →</Text>
              </Pressable>
            </View>
          </View>
          </View>

          {/* GALLERY */}
          <View
            nativeID="gallery"
            id="gallery"
            onLayout={(e) => onSectionLayout("gallery", e.nativeEvent.layout.y)}
            style={styles.sectionBand}
          >
           <View style={styles.container}>
  <View style={styles.heroCard}>
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>Gallery</Text>
    </View>

  <View style={styles.galleryGrid}>
  {galleryLoading ? (
    <Text style={styles.sectionBody}>Loading photos…</Text>
  ) : galleryUrls.length === 0 ? (
    <Text style={styles.sectionBody}>No photos yet.</Text>
  ) : (
    galleryPreview.map((uri, i) => (
      <GalleryTile key={uri} uri={uri} onPress={() => openGalleryAt(i)} />
    ))
  )}
</View>

{!galleryLoading && galleryUrls.length > 4 && (
  <Pressable onPress={() => openGalleryAt(0)} style={styles.viewAllBtn}>
    <Text style={styles.viewAllBtnText}>VIEW ALL PHOTOS</Text>
  </Pressable>
)}
{/* MEET THE COMMISSIONERS (inside Gallery box) */}
{!galleryLoading && galleryUrls.length >= 7 && (
  <View style={styles.commissionersBlock}>
    <Text style={styles.commissionersTitle}>Meet The Commissioners</Text>

<Pressable
  onPress={() => {
    setGalleryMode("commissioners");
    setGalleryIndex(6);
    setGalleryOpen(true);
  }}
  style={styles.commissionerPhotoWrap}
>
<Image source={{ uri: galleryUrls[6] }} resizeMode="cover" style={styles.commissionerPhoto as any} />
      <View style={styles.commissionerOverlay}>
        <Text style={styles.commissionerOverlayText}>VIEW</Text>
      </View>
    </Pressable>
  </View>
)}



  </View>

            </View>
          </View>

          {/* SPONSORS */}
          <View
            nativeID="sponsors"
            id="sponsors"
            onLayout={(e) => onSectionLayout("sponsors", e.nativeEvent.layout.y)}
            style={styles.sectionBand}
          >
            <View style={styles.container}>
  <View style={styles.heroCard}>
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionTitle}>Sponsors</Text>
      <Text style={styles.sectionBody}>Proudly supported by our league partners.</Text>
    </View>

    <View style={styles.sponsorGrid}>
      <SponsorCard
        name="Diadem Sports"
        url="https://diademsports.com/"
        logo={require("../assets/images/Sponsors/diadem.png")}
      />
      <SponsorCard
        name="Ellie Mental Health of Pembroke Pines, FL"
        url="https://elliementalhealth.com/"
        logo={require("../assets/images/Sponsors/ellie.png")}
      />
      <SponsorCard
        name="Zenov BPO"
        url="https://www.zenov-bpo.com/"
        logo={require("../assets/images/Sponsors/zenov.png")}
      />
    </View>
  </View>

            </View>
          </View>

          {/* CONTACT */}
          <View
            nativeID="contact"
            id="contact"
            onLayout={(e) => onSectionLayout("contact", e.nativeEvent.layout.y)}
            style={styles.sectionBand}
          >
            <View style={styles.container}>
  <View style={styles.heroCard}>
    <View style={styles.sectionHeaderRow}>
      <Text style={styles.sectionKicker}>GET IN TOUCH</Text>
      <Text style={styles.sectionTitle}>Contact</Text>
      <Text style={styles.sectionBody}>
        For sponsorship, membership, or general questions, email the league.
      </Text>

      <Pressable
        onPress={() => {
          window.location.href =
            "mailto:parklandpickleballleague@gmail.com?subject=Parkland%20Pickleball%20League%20Inquiry";
        }}
        style={styles.contactBtn}
      >
        <Text style={styles.contactBtnText}>Email Parkland Pickleball League</Text>
      </Pressable>
    </View>

    <Text style={styles.footerFinePrint}>
      © {new Date().getFullYear()} Parkland Pickleball League
    </Text>
  </View>
  </View>

          </View>
        </View>
<Modal visible={galleryOpen} transparent animationType="fade" onRequestClose={() => { setGalleryOpen(false); setGalleryMode("gallery"); }}>
        <View style={styles.lightboxBackdrop}>
          <Pressable style={styles.lightboxBackdropPress} onPress={() => setGalleryOpen(false)} />

          <View style={styles.lightboxCard}>
            <Image
              source={{ uri: galleryUrls[galleryIndex] }}
              resizeMode="contain"
              style={styles.lightboxImg as any}
            />

            <View style={styles.lightboxControls}>
            {galleryMode !== "commissioners" && (
  <Pressable
    onPress={() => setGalleryIndex((i) => (i - 1 + galleryUrls.length) % galleryUrls.length)}
    style={styles.lightboxBtn}
  >
    <Text style={styles.lightboxBtnText}>← Prev</Text>
  </Pressable>
)}


              <Pressable
  onPress={() => {
    setGalleryOpen(false);
    setGalleryMode("gallery");
  }}
  style={styles.lightboxBtn}
>
  <Text style={styles.lightboxBtnText}>Close</Text>
</Pressable>


              {galleryMode !== "commissioners" && (
  <Pressable
    onPress={() => setGalleryIndex((i) => (i + 1) % galleryUrls.length)}
    style={styles.lightboxBtn}
  >
    <Text style={styles.lightboxBtnText}>Next →</Text>
  </Pressable>
)}

            </View>
          </View>
        </View>
      </Modal>

      </ScrollView>
    </SafeAreaView>
  );
}

function TopLink({ label, onPress }: { label: string; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.topLink, hovered && styles.topLinkHover]}
    >
      <Text style={[styles.topLinkText, hovered && styles.topLinkTextHover]}>{label}</Text>
    </Pressable>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoCardTitle}>{title}</Text>
      <Text style={styles.infoCardBody}>{body}</Text>
    </View>
  );
}

function SponsorCard({ name, url, logo }: { name: string; url: string; logo: any }) {
  return (
    <Pressable onPress={() => window.open(url, "_blank")} style={styles.sponsorCard}>
      <Image source={logo} resizeMode="contain" style={styles.sponsorLogoFill} />
      <Text style={styles.sponsorName}>{name}</Text>
    </Pressable>
  );
}

function GalleryTile({ uri, onPress }: { uri: string; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.galleryTile, hovered && styles.galleryTileHover]}
    >
      <Image source={{ uri }} resizeMode="cover" style={styles.galleryImgFill as any} />
      <View style={[styles.galleryOverlay, hovered && styles.galleryOverlayHover]}>
        <Text style={styles.galleryOverlayText}>VIEW</Text>
      </View>
    </Pressable>
  );
}



const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  bg: { ...StyleSheet.absoluteFillObject, backgroundColor: "#FFFFFF" },

  // ✅ NEW: make the scroll container fill the screen
  scroll: { flex: 1 },

  page: {
    paddingHorizontal: 0,
    paddingBottom: 0,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },

  // HERO (full width)
  hero: {
    width: "100%",
  },

  heroBg: {
    width: "100%",
    height: 560,
    position: "relative",
    overflow: "visible",
    backgroundColor: "#0B1220",
  },

  heroImg: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none" as any,
    transform: [{ scale: 1.02 }],
  } as any,

  heroVignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundImage:
      "radial-gradient(circle at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.62) 100%)" as any,
  } as any,

  // TOP NAV OVER HERO (UNCHANGED)
  heroTopNav: {
    position: "absolute" as any,
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 16,
    paddingBottom: 10,
  } as any,

  heroTopInner: {
    width: "100%",
    paddingHorizontal: 26,
    flexDirection: "row",
    alignItems: "center",
  },

  topLogo: { width: 140, height: 140 },

  topLinksSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },

  topLinks: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 22,
  } as any,

  topLink: {
    cursor: "pointer" as any,
    paddingVertical: 8,
    paddingHorizontal: 6,
    transitionProperty: "opacity, transform, text-shadow" as any,
    transitionDuration: "140ms" as any,
    transitionTimingFunction: "ease-out" as any,
  } as any,

  topLinkHover: {
    opacity: 1,
    transform: [{ translateY: -2 }, { scale: 1.06 }],
  } as any,

  topLinkText: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 2.4,
    fontSize: 14,
    textShadowColor: "rgba(0,0,0,0.55)" as any,
    textShadowOffset: { width: 0, height: 2 } as any,
    textShadowRadius: 6 as any,
  } as any,

  topLinkTextHover: {
    color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.7)" as any,
    textShadowOffset: { width: 0, height: 3 } as any,
    textShadowRadius: 10 as any,
  } as any,

  memberLoginBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    cursor: "pointer" as any,
    boxShadow: "0 16px 40px rgba(0,0,0,0.45)" as any,
    backdropFilter: "blur(4px)" as any,
    transitionProperty: "transform, box-shadow" as any,
    transitionDuration: "160ms" as any,
    transitionTimingFunction: "ease-out" as any,
  } as any,

  memberLoginText: {
    color: "#0F172A",
    fontWeight: "900",
    letterSpacing: 2.2,
    fontSize: 12,
  } as any,

  heroCardOuter: {
    position: "absolute" as any,
    left: 0,
    right: 0,
    bottom: -280,
    alignItems: "center",
    paddingHorizontal: 22,
  } as any,

  heroCard: {
    width: "100%",
    maxWidth: 1150,
    backgroundColor: "#F1F5F9",
    borderRadius: 18,
    paddingHorizontal: 44,
    paddingVertical: 40,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)" as any,
    boxShadow: "0 28px 70px rgba(15, 23, 42, 0.18)" as any,
    alignItems: "center",
  } as any,

  heroCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  } as any,

  heroAccent: {
    width: 34,
    height: 3,
    borderRadius: 10,
    backgroundColor: "#0F4B52",
  },

  heroCardKicker: {
    fontSize: 12,
    letterSpacing: 2.2,
    fontWeight: "900",
    color: "rgba(15, 75, 82, 0.85)" as any,
  } as any,

  heroCardTitle: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: "700",
    letterSpacing: -0.5,
    color: "#0F172A",
    textAlign: "center",
  },

  heroCardBody: {
    marginTop: 18,
    fontSize: 16,
    lineHeight: 26,
    color: "#334155",
    maxWidth: 860,
    textAlign: "center",
  },

  heroCardDivider: {
    height: 1,
    width: "100%",
    backgroundColor: "rgba(15, 23, 42, 0.10)" as any,
    marginTop: 18,
    marginBottom: 16,
  },

  heroMiniRow: {
    flexDirection: "row",
    gap: 18,
    alignItems: "center",
    flexWrap: "wrap",
  } as any,

  miniStat: {
    backgroundColor: "rgba(255,255,255,0.55)" as any,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)" as any,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minWidth: 150,
    alignItems: "center",
    justifyContent: "center",
  } as any,

  miniStatValue: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
  },

  miniStatLabel: {
    marginTop: 2,
    fontSize: 12,
    color: "#64748B",
    fontWeight: "700",
    textAlign: "center",
  },

  lowerWrap: {
    width: "100%",
    backgroundColor: "#FFFFFF",
  },

  container: {
    width: "100%",
    maxWidth: 1150,
    paddingHorizontal: 22,
    alignSelf: "center",
  },

  sectionBand: {
    width: "100%",
    paddingTop: 68,
    paddingBottom: 64,
    backgroundColor: "#FFFFFF",
  },

  sectionBandAlt: {
    width: "100%",
    paddingTop: 68,
    paddingBottom: 64,
    backgroundColor: "#F8FAFC",
    borderTopWidth: 1,
    borderTopColor: "rgba(15, 23, 42, 0.06)" as any,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15, 23, 42, 0.06)" as any,
  } as any,

  sectionHeaderRow: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    alignItems: "center",
    textAlign: "center" as any,
  },

  sectionKicker: {
    fontSize: 12,
    letterSpacing: 2.4,
    fontWeight: "900",
    color: "rgba(15, 75, 82, 0.78)" as any,
    marginBottom: 10,
  } as any,

  sectionTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "900",
    color: "#0F172A",
  },

  sectionBody: {
    marginTop: 18,
    fontSize: 16,
    lineHeight: 26,
    color: "#334155",
    maxWidth: 860,
    textAlign: "center",
  },

  cardRow: {
    marginTop: 30,
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 22,
  } as any,

  infoCard: {
    width: "32%",
    minHeight: 190, // slightly taller for balance
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)" as any,
    paddingTop: 30, // fixed top spacing
    paddingBottom: 26,
    paddingHorizontal: 28,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.10)" as any,
    alignItems: "center",
  } as any,

  infoCardTitle: {
    fontSize: 18, // ⬅ bigger
    fontWeight: "900",
    color: "#0F172A",
    minHeight: 54, // ⬅ slightly taller to support size
    textAlign: "center",
    letterSpacing: 0.3,
  },

  infoCardBody: {
    marginTop: 10,
    fontSize: 15, // ⬅ larger
    lineHeight: 24, // ⬅ better readability
    color: "#475569", // ⬅ slightly darker for clarity
    textAlign: "center",
  },

  galleryGrid: {
    width: "100%",
    flexDirection: "row",
    gap: 14,
    marginTop: 26,
  } as any,

  galleryTile: {
    flex: 1,
    height: 190,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)" as any,
    overflow: "hidden",
    cursor: "pointer" as any,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.10)" as any,
    transitionProperty: "transform, box-shadow" as any,
    transitionDuration: "160ms" as any,
    transitionTimingFunction: "ease-out" as any,
  } as any,

  galleryTileHover: {
    transform: [{ translateY: -4 }],
    boxShadow: "0 26px 60px rgba(15, 23, 42, 0.16)" as any,
  } as any,

  galleryTileInner: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#F1F5F9",
  },
  galleryImgFill: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },

  galleryOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.0)" as any,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
    transitionProperty: "opacity, background-color" as any,
    transitionDuration: "160ms" as any,
    transitionTimingFunction: "ease-out" as any,
  } as any,

  galleryOverlayHover: {
    opacity: 1,
    backgroundColor: "rgba(15, 23, 42, 0.28)" as any,
  } as any,

  galleryOverlayText: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "900",
    letterSpacing: 2.2,
    fontSize: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)" as any,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.18)" as any,
  } as any,

  sponsorGrid: {
    width: "100%",
    flexDirection: "row",
    gap: 22,
    marginTop: 26,
    flexWrap: "wrap",
    justifyContent: "space-between",
  } as any,

  sponsorCard: {
    width: "31%",
    minHeight: 190,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)" as any,
    paddingVertical: 22,
    paddingHorizontal: 18,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.10)" as any,
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer" as any,
  } as any,

  sponsorLogoFill: {
    width: "100%",
    height: 110,
  } as any,

  sponsorLogoStub: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.06)" as any,
    marginBottom: 12,
  } as any,

  sponsorName: {
    marginTop: 16,
    color: "#0F172A",
    fontWeight: "900",
    fontSize: 14,
    textAlign: "center",
  } as any,

  sponsorSub: {
    marginTop: 4,
    fontSize: 12,
    color: "#64748B",
    fontWeight: "700",
  },

  contactBtn: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#0F172A",
    alignSelf: "center",
    cursor: "pointer" as any,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)" as any,
  } as any,

  contactBtnText: { color: "#FFFFFF", fontWeight: "900", letterSpacing: 0.3 },

  footerFinePrint: {
    marginTop: 34,
    fontSize: 12,
    color: "#64748B",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(15, 23, 42, 0.08)" as any,
  } as any,

  membershipCard: {
    marginTop: 36,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)" as any,
    paddingVertical: 26,
    paddingHorizontal: 28,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.10)" as any,
    cursor: "pointer" as any,
    alignItems: "center",
    transitionProperty: "transform, box-shadow" as any,
    transitionDuration: "160ms" as any,
    transitionTimingFunction: "ease-out" as any,
  } as any,

  membershipCardTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
  },

  membershipCardEmail: {
    marginTop: 6,
    fontSize: 14,
    color: "#475569",
    fontWeight: "700",
    textAlign: "center",
  },

  membershipCardAction: {
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#0F172A",
    textAlign: "center",
  },
    lightboxBackdrop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.75)" as any,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  } as any,

  lightboxBackdropPress: {
    ...StyleSheet.absoluteFillObject,
  },

  lightboxCard: {
    width: "100%",
    maxWidth: 1100,
    backgroundColor: "#0B1220",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)" as any,
    overflow: "hidden",
    boxShadow: "0 22px 60px rgba(0,0,0,0.55)" as any,
  } as any,

  lightboxImg: {
    width: "100%",
    height: 620,
    backgroundColor: "#0B1220",
  } as any,

  lightboxControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
    gap: 12,
  } as any,

  lightboxBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)" as any,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)" as any,
    cursor: "pointer" as any,
  } as any,

  lightboxBtnText: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 0.4,
  } as any,

    viewAllBtn: {
    marginTop: 18,
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#0F172A",
    cursor: "pointer" as any,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)" as any,
  } as any,

  viewAllBtnText: {
    color: "#FFFFFF",
    fontWeight: "900",
    letterSpacing: 2,
    fontSize: 12,
  } as any,

    commissionersBlock: {
    marginTop: 28,
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    alignItems: "center",
  },

  commissionersTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 14,
  },

  commissionerPhotoWrap: {
    width: "100%",
    maxWidth: 520,
    height: 700,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(15, 23, 42, 0.08)" as any,
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.10)" as any,
    cursor: "pointer" as any,
  } as any,

  commissionerPhoto: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },

  commissionerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.0)" as any,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
    transitionProperty: "opacity, background-color" as any,
    transitionDuration: "160ms" as any,
    transitionTimingFunction: "ease-out" as any,
  } as any,

  commissionerOverlayText: {
    color: "rgba(255,255,255,0.92)",
    fontWeight: "900",
    letterSpacing: 2.2,
    fontSize: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)" as any,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.18)" as any,
  } as any,



});
