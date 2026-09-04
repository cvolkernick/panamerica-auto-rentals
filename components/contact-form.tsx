"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ContactFormProps = {
  email: string;
};

export function ContactForm({ email }: ContactFormProps) {
  const [name, setName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [message, setMessage] = useState("");

  const mailto = useMemo(() => {
    const subject = name.trim()
      ? `Inquiry from ${name.trim()}`
      : "Inquiry from the Panamerica site";
    const body = [
      name.trim() ? `Name: ${name.trim()}` : null,
      fromEmail.trim() ? `Email: ${fromEmail.trim()}` : null,
      "",
      message.trim() || "(no message)",
    ]
      .filter((line) => line !== null)
      .join("\n");

    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [email, fromEmail, message, name]);

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        window.location.href = mailto;
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="name" className="font-heading tracking-[0.12em] text-white/80 uppercase">
          Name
        </Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-11 border-white/15 bg-white/5 text-base text-white md:text-base"
          placeholder="Your name"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email" className="font-heading tracking-[0.12em] text-white/80 uppercase">
          Email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={fromEmail}
          onChange={(event) => setFromEmail(event.target.value)}
          className="h-11 border-white/15 bg-white/5 text-base text-white md:text-base"
          placeholder="you@example.com"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="message" className="font-heading tracking-[0.12em] text-white/80 uppercase">
          Message
        </Label>
        <Textarea
          id="message"
          name="message"
          required
          rows={6}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="min-h-36 border-white/15 bg-white/5 text-base text-white md:text-base"
          placeholder="What do you need help with?"
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          className="h-11 bg-red px-6 font-heading tracking-[0.18em] text-white uppercase hover:bg-red/90"
        >
          Send
        </Button>
        <p className="text-sm text-white/60">
          Opens your mail app to{" "}
          <a href={`mailto:${email}`} className="text-gold underline-offset-4 hover:underline">
            {email}
          </a>
          .
        </p>
      </div>
    </form>
  );
}
