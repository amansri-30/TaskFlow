"use client";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import PageTemplate from "@/components/elements/PageTemplate";
import CustomButton from "@/components/elements/CustomButton";
import { baseRedColor } from "@/lib/Colors";
import toast from "react-hot-toast";
import axios from "axios";
import AlertBox from "@/components/elements/AlertBox";

import HandPrayerIcon from "@/public/svg/icons/HandPrayerIcon";
import UploadSquare01Icon from "@/public/svg/icons/UploadSquare01Icon";

const Feedback = () => {
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState("");
  const [alertShown, setAlertShown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !feedback.trim()) {
      toast.error("Email and feedback are required");
      return;
    }
    setSubmitting(true);
    try {
      await axios.post("/api/feedback", {
        email: email.trim(),
        message: feedback.trim(),
      });
      setHasError(false);
      toast.success("Feedback submitted successfully");
      setEmail("");
      setFeedback("");
      setAlertShown(true);
      setTimeout(() => setAlertShown(false), 10000);
    } catch (error: any) {
      const message =
        error?.response?.data?.message || "Failed to submit feedback";
      setHasError(true);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageTemplate>
      <div className="flex mt-10 mb-10 items-start justify-center min-h-[70vh]">
        <Card className="max-w-[500px]">
          <CardHeader>
            <CardTitle className="mb-4 sm:mx-10 montserrat">
              Send <span className={`text-red-500`}>Us</span> Your Feedback
            </CardTitle>
            <CardDescription>
              We value your feedback! Share your thoughts with us.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <div className="grid w-full items-center gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email" className="text-left">
                    Email
                  </Label>
                  <Input
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                    id="email"
                    type="email"
                    placeholder="myemail@example.com"
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="feedback" className="text-left">
                    Feedback
                  </Label>
                  <Textarea
                    id="feedback"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Enter your feedback here..."
                    rows={5}
                    required
                  />
                </div>
              </div>
              <CardFooter className="flex justify-between mt-4">
                <CustomButton
                  rightIcon={<UploadSquare01Icon />}
                  className="text-sm w-full"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? "Submitting..." : "Submit"}
                </CustomButton>
              </CardFooter>
            </form>

            {alertShown && (
              <AlertBox
                alertShown={alertShown}
                title={hasError ? "Feedback Not Delivered" : "Feedback Submitted"}
                description={
                  hasError
                    ? "Something went wrong while sending your feedback. Please try again."
                    : "Thank you for your feedback! We'll review it soon."
                }
                icon={<HandPrayerIcon />}
              />
            )}
            
          </CardContent>
        </Card>
      </div>
    </PageTemplate>
  );
};

export default Feedback;
