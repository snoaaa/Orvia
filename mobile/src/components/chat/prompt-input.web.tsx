import { ArrowUp } from "lucide-react";
import { Children, type ReactNode, isValidElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  TextInput,
  View,
} from "react-native";

import { useChatContext } from "./chat-context";
import { useConversationContext } from "./conversation";

/**
 * Root container for the message composer matching Vercel chatbot design.
 * Centered max-w-4xl card with rounded-2xl border/shadow.
 * Collects PromptInputAction children and renders them in a footer row.
 */
export function PromptInput({ children }: { children: ReactNode }) {
  const { onPromptInputLayout } = useConversationContext();

  // Separate action buttons from body (which contains textarea + submit)
  const actions: ReactNode[] = [];
  let body: ReactNode = null;

  Children.forEach(children, (child) => {
    if (isValidElement(child) && (child.type as any) === PromptInputAction) {
      actions.push(child);
    } else if (
      isValidElement(child) &&
      (child.type as any) === PromptInputBody
    ) {
      body = child;
    }
  });

  return (
    <View
      onLayout={onPromptInputLayout}
      className="sticky bottom-0 z-10 mx-auto flex w-full max-w-4xl gap-2 bg-background px-2 pb-3 md:px-4 md:pb-4"
    >
      <View className="flex w-full flex-col rounded-2xl border border-border/30 bg-card/70 shadow-composer transition-shadow duration-300 focus-within:shadow-composer-focus">
        {body}
      </View>
    </View>
  );
}

/**
 * Action button (e.g. attachments) in the composer footer.
 */
export function PromptInputAction({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/40 transition-colors hover:bg-accent"
    >
      {children}
    </Pressable>
  );
}

/**
 * Container wrapping the textarea and the footer row with submit.
 * On web, PromptInputBody renders the textarea children PLUS a footer row.
 */
export function PromptInputBody({ children }: { children: ReactNode }) {
  // Separate textarea from submit button
  const textarea: ReactNode[] = [];
  let submit: ReactNode = null;

  Children.forEach(children, (child) => {
    if (isValidElement(child) && (child.type as any) === PromptInputSubmit) {
      submit = child;
    } else {
      textarea.push(child);
    }
  });

  return (
    <View className="flex flex-col">
      {/* Textarea area */}
      {textarea}
      {/* Footer row */}
      <View className="flex flex-row items-center justify-end px-3 pb-3">
        {submit}
      </View>
    </View>
  );
}

/**
 * Auto-growing text input matching Orvia's web composer textarea.
 */
export function PromptInputTextarea({
  placeholder = "Posez une question sur vos documents…",
  maxLength = 1000,
}: {
  placeholder?: string;
  maxLength?: number;
}) {
  const { input, setInput, onSend } = useChatContext();

  return (
    <TextInput
      nativeID="composer"
      className="min-h-24 w-full bg-transparent px-4 pt-3.5 pb-1.5 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/35 outline-none"
      style={{ maxHeight: 200, resize: "none" } as any}
      value={input}
      onChangeText={setInput}
      placeholder={placeholder}
      placeholderTextColorClassName="tint-muted-foreground"
      multiline
      maxLength={maxLength}
      onKeyPress={(e) => {
        if (
          (e as any).nativeEvent.key === "Enter" &&
          !(e as any).nativeEvent.shiftKey
        ) {
          e.preventDefault();
          onSend();
        }
      }}
    />
  );
}

/**
 * Submit button matching Vercel chatbot's send/stop button.
 */
export function PromptInputSubmit() {
  const { input, isGenerating, onSend } = useChatContext();
  const disabled = !input.trim() || isGenerating;

  return (
    <Pressable
      onPress={onSend}
      disabled={disabled}
      className={`flex h-7 w-7 items-center justify-center rounded-xl transition-all duration-200 ${
        disabled
          ? "bg-muted cursor-not-allowed"
          : "bg-foreground hover:opacity-85 active:scale-95"
      }`}
    >
      {isGenerating ? (
        <ActivityIndicator size="small" colorClassName="tint-background" />
      ) : (
        <ArrowUp
          size={16}
          strokeWidth={2.5}
          className={disabled ? "text-muted-foreground/25" : "text-background"}
        />
      )}
    </Pressable>
  );
}
