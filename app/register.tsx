import React, { useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";

export default function RegisterPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [division, setDivision] = useState("");
  const [showDivisionOptions, setShowDivisionOptions] = useState(false);

  const [hasPartner, setHasPartner] = useState("");
  const [showPartnerOptions, setShowPartnerOptions] = useState(false);
  const [partnerName, setPartnerName] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");

  const [paymentChoice, setPaymentChoice] = useState("");
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);

  const [showPaymentSection, setShowPaymentSection] = useState(false);

  const [showPaymentMethods, setShowPaymentMethods] = useState(false);
  const [showZelleInfo, setShowZelleInfo] = useState(false);
const [showPayPalInfo, setShowPayPalInfo] = useState(false);

  const canContinueToPayment =
    fullName.trim() !== "" &&
    email.trim() !== "" &&
    phoneNumber.trim() !== "" &&
    division.trim() !== "" &&
    hasPartner.trim() !== "" &&
    paymentChoice.trim() !== "" &&
    (hasPartner !== "Yes" ||
      (partnerName.trim() !== "" && partnerPhone.trim() !== ""));

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <Text style={styles.title}>Register for Season</Text>

          <View style={styles.form}>
            <TextInput
              placeholder="Full Name"
              value={fullName}
              onChangeText={setFullName}
              style={styles.input}
            />

            <TextInput
              placeholder="Email Address"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
            />

            <TextInput
              placeholder="Phone Number"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              style={styles.input}
            />

            <View style={{ width: "100%" }}>
              <Pressable
                onPress={() => setShowDivisionOptions(!showDivisionOptions)}
                style={styles.input}
              >
                <Text style={styles.inputText}>
                  {division || "Select Division"}
                </Text>
              </Pressable>

              {showDivisionOptions && (
                <View style={styles.dropdown}>
                  {["Beginner", "Intermediate", "Advanced"].map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => {
                        setDivision(item);
                        setShowDivisionOptions(false);
                      }}
                      style={styles.dropdownItem}
                    >
                      <Text style={styles.inputText}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={{ width: "100%" }}>
              <Pressable
                onPress={() => setShowPartnerOptions(!showPartnerOptions)}
                style={styles.input}
              >
                <Text style={styles.inputText}>
                  {hasPartner || "Do you have a partner?"}
                </Text>
              </Pressable>

              {showPartnerOptions && (
                <View style={styles.dropdown}>
                  {["Yes", "No"].map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => {
                        setHasPartner(item);
                        setShowPartnerOptions(false);
                        if (item === "No") {
                          setPartnerName("");
                          setPartnerPhone("");
                        }
                      }}
                      style={styles.dropdownItem}
                    >
                      <Text style={styles.inputText}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {hasPartner === "Yes" && (
                <>
                  <TextInput
                    placeholder="Partner Name"
                    value={partnerName}
                    onChangeText={setPartnerName}
                    style={styles.input}
                  />

                  <TextInput
                    placeholder={
                      partnerName
                        ? `Enter ${partnerName}'s Phone Number`
                        : "Partner Phone Number"
                    }
                    value={partnerPhone}
                    onChangeText={setPartnerPhone}
                    style={styles.input}
                  />
                </>
              )}
            </View>

            <View style={{ width: "100%" }}>
              <Pressable
                onPress={() => setShowPaymentOptions(!showPaymentOptions)}
                style={styles.input}
              >
                <Text style={styles.inputText}>
                  {paymentChoice || "Who are you paying for?"}
                </Text>
              </Pressable>

              {showPaymentOptions && (
                <View style={styles.dropdown}>
                  {["Only Myself", "Myself and My Partner"].map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => {
                        setPaymentChoice(item);
                        setShowPaymentOptions(false);
                      }}
                      style={styles.dropdownItem}
                    >
                      <Text style={styles.inputText}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {canContinueToPayment && !showPaymentSection && (
  <Pressable
    onPress={async () => {
      try {
        await fetch("/api/send-registration", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fullName,
            email,
            phoneNumber,
            division,
            hasPartner,
            partnerName,
            partnerPhone,
            paymentChoice,
          }),
        });

        setShowPaymentSection(true);
      } catch (error) {
        console.error("Error sending registration:", error);
      }
    }}
    style={styles.continueBtn}
  >
    <Text style={styles.continueBtnText}>
      Submit Registration & Continue to Payment
    </Text>
  </Pressable>
)}

            {showPaymentSection && (
              <View style={styles.paymentSection}>
                <Text style={styles.paymentTitle}>Payment Information</Text>

                <Text style={styles.paymentBody}>
                  Please review your registration details above, then submit
                  payment using the league payment option below.
                </Text>

                <Text style={styles.paymentBody}>
                  Payment selection:{" "}
                  <Text style={styles.paymentBold}>{paymentChoice}</Text>
                </Text>

                <View style={{ width: "100%" }}>
  <Pressable
    onPress={() => setShowPaymentMethods(!showPaymentMethods)}
    style={styles.payNowBtn}
  >
    <Text style={styles.payNowBtnText}>Pay League Dues</Text>
  </Pressable>

  {showPaymentMethods && (
    <View style={styles.dropdown}>
      {["Pay with Zelle", "Pay with PayPal"].map((item) => (
        <Pressable
          key={item}
          onPress={() => {
            if (item === "Pay with PayPal") {
  setShowPayPalInfo(true);
  setShowZelleInfo(false);
  setShowPaymentMethods(false);
}
if (item === "Pay with Zelle") {
  setShowZelleInfo(true);
  setShowPayPalInfo(false);
  setShowPaymentMethods(false);
}
          }}
          style={styles.dropdownItem}
        >
          <Text style={styles.inputText}>{item}</Text>
        </Pressable>
      ))}
    </View>
  )}
  {showZelleInfo && (
  <View style={styles.paymentInfoCard}>
    <Text style={styles.paymentInfoTitle}>Pay by Zelle</Text>
    <Text style={styles.paymentInfoBody}>
      Send{" "}
      {paymentChoice === "Myself and My Partner" ? "$300" : "$175"}{" "}
      payment via Zelle to:
    </Text>
    <Text style={styles.paymentInfoEmail}>
      parklandpickleballleague@gmail.com
    </Text>
    <Text style={styles.paymentInfoBody}>
      Memo: {fullName || "Your Name"} - {division || "Division"}
    </Text>
  </View>
)}
{showPayPalInfo && (
  <View style={styles.paymentInfoCard}>
    <Text style={styles.paymentInfoTitle}>Pay with PayPal</Text>

    <Text style={styles.paymentInfoBody}>
      Click below to complete your payment securely through PayPal.
    </Text>

    <Pressable
      onPress={() =>
        window.open(
          "https://www.paypal.com/ncp/payment/LG7NA3X2JFSAN",
          "_blank"
        )
      }
      style={styles.paypalBtn}
    >
      <Text style={styles.paypalBtnText}>Continue to PayPal</Text>
    </Pressable>
  </View>
)}
</View>
              </View>
            )}
          </View>

          <Pressable onPress={() => router.push("/")} style={styles.backBtn}>
            <Text style={styles.backBtnText}>Back to Home</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },

  scrollContent: {
    flexGrow: 1,
  },

  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
  },

  title: {
    fontSize: 32,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
  },

  body: {
    marginTop: 16,
    fontSize: 16,
    lineHeight: 24,
    color: "#475569",
    textAlign: "center",
  },

  backBtn: {
    marginTop: 28,
    backgroundColor: "#0F172A",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },

  backBtnText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },

  form: {
    marginTop: 24,
    width: "100%",
    maxWidth: 500,
  },

  input: {
    width: "100%",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.1)",
  },

  pickerWrap: {
    width: "100%",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.1)",
    overflow: "hidden",
  },

  picker: {
    width: "100%",
    height: 56,
  },

  dropdown: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.1)",
    overflow: "hidden",
  },

  dropdownItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(15,23,42,0.05)",
  },

  inputText: {
    fontSize: 16,
    color: "#0F172A",
  },

  continueBtn: {
    marginTop: 20,
    backgroundColor: "#0F172A",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: "center",
  },

  continueBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },

  paymentSection: {
    marginTop: 20,
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    padding: 18,
  },

  paymentTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 10,
  },

  paymentBody: {
    fontSize: 15,
    lineHeight: 24,
    color: "#475569",
    marginTop: 6,
  },

  paymentBold: {
    fontWeight: "900",
    color: "#0F172A",
  },

  payNowBtn: {
    marginTop: 18,
    backgroundColor: "#0070BA",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: "center",
  },

  payNowBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  paymentInfoCard: {
  marginTop: 12,
  backgroundColor: "#F8FAFC",
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "rgba(15,23,42,0.08)",
  padding: 16,
},

paymentInfoTitle: {
  fontSize: 18,
  fontWeight: "900",
  color: "#0F172A",
  marginBottom: 8,
},

paymentInfoBody: {
  fontSize: 15,
  lineHeight: 22,
  color: "#475569",
  marginTop: 4,
},

paymentInfoEmail: {
  marginTop: 8,
  fontSize: 16,
  fontWeight: "900",
  color: "#0F172A",
},
paypalBtn: {
  marginTop: 14,
  backgroundColor: "#0070BA",
  borderRadius: 12,
  paddingVertical: 14,
  alignItems: "center",
},

paypalBtnText: {
  color: "#FFFFFF",
  fontWeight: "900",
  fontSize: 16,
},
});