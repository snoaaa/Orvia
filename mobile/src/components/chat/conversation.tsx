"use no memo";
import { SymbolImage } from "@/components/symbol-image";
import { LegendList, LegendListRef } from "@legendapp/list";
import {
  createContext,
  use,
  useCallback,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { LayoutChangeEvent, Text, View, Keyboard, Platform } from "react-native";
import { useEffect } from "react";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TouchableGlass } from "../touchable-glass";
import { useChatContext } from "./chat-context";
import type { ChatMessage } from "./types";

const IS_GLASS = Platform.OS === 'ios';

// Removed AnimatedLegendList to fix Fabric crash on custom components

type AnimatedStyle = any;

type ConversationContextValue = {
  scrollToBottom: () => void;
  /** Animated style that positions the prompt input above the keyboard. */
  promptInputStyle: AnimatedStyle;
  /** Prompt input reports its measured height through this callback. */
  onPromptInputLayout: (e: LayoutChangeEvent) => void;
  /** Animated style for the scroll-to-bottom button. */
  scrollButtonStyle: AnimatedStyle;
};

const ConversationCtx = createContext<ConversationContextValue | null>(null);

export function useConversationContext() {
  const ctx = use(ConversationCtx);
  if (!ctx)
    throw new Error(
      "useConversationContext must be used within <Conversation>",
    );
  return ctx;
}

export function Conversation({
  renderMessage,
  emptyState,
  children,
}: {
  /** Render callback for each message – passed to the underlying list. */
  renderMessage: (info: { item: ChatMessage }) => ReactElement;
  /** Element shown when the message list is empty. */
  emptyState?: ReactElement;
  /** Compound children: <ConversationScrollButton />, <PromptInput />, etc. */
  children?: ReactNode;
}) {
  const { messages } = useChatContext();
  const listRef = useRef<LegendListRef>(null);
  const insets = useSafeAreaInsets();

  // -- Keyboard tracking --------------------------------------------------

  const scrollToBottomRef = useRef<() => void>(() => {});
  const keyboardHeight = useSharedValue(0);
  const keyboardHeightForInset = useSharedValue(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const duration = e.duration || 250;
      keyboardHeight.value = withTiming(e.endCoordinates.height, { duration });
      keyboardHeightForInset.value = withTiming(e.endCoordinates.height, { duration });
      runOnJS(scrollToBottomRef.current)();
    });
    
    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      const duration = e.duration || 250;
      keyboardHeight.value = withTiming(0, { duration });
      keyboardHeightForInset.value = withTiming(0, { duration });
    });
    
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // -- Layout bookkeeping --------------------------------------------------

  const composerHeight = useSharedValue(68);
  const scrollViewHeight = useSharedValue(0);
  const totalContentHeight = useSharedValue(0);
  const currentFooterHeight = useSharedValue(0);
  const messagesOnlyHeight = useSharedValue(0);

  // -- Auto-scroll ---------------------------------------------------------

  const scrollY = useSharedValue(0);
  const lastContentHeight = useSharedValue(0);
  const SCROLL_THRESHOLD = 50;

  const bottomInset = useDerivedValue(() => {
    const keyboard = Math.abs(keyboardHeight.value);
    return composerHeight.value + Math.max(insets.bottom, keyboard);
  });

  const isAtBottom = useDerivedValue(() => {
    const maxScrollY =
      totalContentHeight.value - scrollViewHeight.value + bottomInset.value;
    if (maxScrollY <= 0) return true;
    return maxScrollY - scrollY.value <= SCROLL_THRESHOLD;
  });

  const shouldShowScrollButton = useDerivedValue(() => {
    const maxScrollY =
      totalContentHeight.value - scrollViewHeight.value + bottomInset.value;
    if (maxScrollY <= 50) return false;
    return !isAtBottom.value;
  });

  // -- Callbacks -----------------------------------------------------------

  const onScrollViewLayout = useCallback((e: LayoutChangeEvent) => {
    scrollViewHeight.value = e.nativeEvent.layout.height;
  }, []);

  const onScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      scrollY.value = event.nativeEvent.contentOffset.y;
    },
    [],
  );

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    const wasAtBottom = isAtBottom.value;
    const heightIncreased = height > lastContentHeight.value;

    totalContentHeight.value = height;
    lastContentHeight.value = height;
    // Derive message-only height by subtracting the last known footer height.
    // This is stable: when the footer resizes, totalContent changes but
    // messagesOnly stays the same, breaking the feedback loop.
    messagesOnlyHeight.value = height - currentFooterHeight.value;

    if (wasAtBottom && heightIncreased && listRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({
          animated: true,
          viewOffset: -bottomInset.value,
        });
      });
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({
      animated: true,
      viewOffset: -bottomInset.value,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom]);

  // -- Animated styles -----------------------------------------------------
  const topPadding = IS_GLASS ? 128 : 16;

  const footerSpacerStyle = useAnimatedStyle(() => {
    const scrollHeight = scrollViewHeight.value;
    if (scrollHeight <= 0) return { height: 0 };

    const keyboard = Math.abs(keyboardHeight.value);
    const bottom = composerHeight.value + Math.max(insets.bottom, keyboard);
    const blankSpace = scrollHeight - messagesOnlyHeight.value - bottom;
    const footerHeight = Math.max(0, blankSpace - topPadding);

    // eslint-disable-next-line react-hooks/immutability -- Reanimated SharedValue mutation in worklet
    currentFooterHeight.value = footerHeight;
    return { height: footerHeight };
  });

  const promptInputStyle = useAnimatedStyle(() => ({
    bottom: Math.max(insets.bottom, Math.abs(keyboardHeight.value)),
  }));

  const scrollButtonStyle = useAnimatedStyle(() => ({
    opacity: withTiming(shouldShowScrollButton.value ? 1 : 0, {
      duration: 200,
    }),
    transform: [
      {
        scale: withTiming(shouldShowScrollButton.value ? 1 : 0.8, {
          duration: 200,
        }),
      },
    ],
    bottom:
      composerHeight.value +
      Math.max(insets.bottom, Math.abs(keyboardHeight.value)) +
      12,
  }));

  const [listBottomInset, setListBottomInset] = useState(insets.bottom + 68);

  useAnimatedReaction(
    () => {
      const keyboard = Math.abs(keyboardHeightForInset.value);
      return composerHeight.value + Math.max(insets.bottom, keyboard);
    },
    (bottom) => {
      runOnJS(setListBottomInset)(bottom);
    }
  );

  const onPromptInputLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    composerHeight.value = h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Context value -------------------------------------------------------

  const contextValue: ConversationContextValue = {
    scrollToBottom,
    promptInputStyle,
    onPromptInputLayout,
    scrollButtonStyle,
  };

  // -- Render --------------------------------------------------------------

  return (
    <ConversationCtx value={contextValue}>
      <View className="flex-1 bg-background">
        <View className="flex-1">
          <LegendList
            ref={listRef as never}
            data={messages}
            renderItem={renderMessage as any}
            keyExtractor={(item) => (item as ChatMessage).id}
            contentContainerStyle={{
              padding: 16,
              // transparent header spacing.
              paddingBottom: 8,
            }}
            keyboardDismissMode="interactive"
            automaticallyAdjustsScrollIndicatorInsets={false}
            maintainVisibleContentPosition
            estimatedItemSize={80}
            // contentInset not supported by LegendList - padding handled via contentContainerStyle
            scrollIndicatorInsets={{ top: 0, left: 0, right: 0, bottom: listBottomInset }}
            onLayout={onScrollViewLayout}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onContentSizeChange={onContentSizeChange}
            ListFooterComponent={
              <Animated.View style={footerSpacerStyle}>
                {!messages.length && emptyState}
              </Animated.View>
            }
          />
        </View>

        {children}
      </View>
    </ConversationCtx>
  );
}


export function ConversationScrollButton() {
  const { scrollToBottom, scrollButtonStyle } = useConversationContext();

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[{ position: "absolute", right: 16 }, scrollButtonStyle]}
    >
      <TouchableGlass
        onPress={scrollToBottom}
        hitSlop={8}
        className="w-10 h-10 rounded-full justify-center items-center"
      >
        <SymbolImage
          name="chevron.down"
          sfEffect={{effect: "wiggle", repeat: -1, }}
          className="text-muted-foreground text-xs mt-1"
        />
      </TouchableGlass>
    </Animated.View>
  );
}

export function ConversationEmptyState({
  title = "Ready",
  description,
  icon = "bubble.left.and.bubble.right",
}: {
  title?: string;
  description?: string;
  icon?: string;
}) {
  return (
    <View className="flex-1 justify-center items-center gap-2">
      <SymbolImage
        name={icon}
        size={48}
        className="text-muted-foreground"
      />
      <Text className="text-xl font-semibold text-foreground">
        {title}
      </Text>
      {description && (
        <Text className="text-sm text-muted-foreground">
          {description}
        </Text>
      )}
    </View>
  );
}
