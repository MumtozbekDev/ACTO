import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // Меньше минуты
  if (diff < 60000) {
    return "сейчас"
  }

  // Меньше часа
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000)
    return `${minutes}м`
  }

  // Сегодня
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  // Вчера
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return "вчера"
  }

  // Этот год
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    })
  }

  // Другой год
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function generateAvatar(name: string): string {
  const colors = [
    "bg-red-500",
    "bg-blue-500",
    "bg-green-500",
    "bg-yellow-500",
    "bg-purple-500",
    "bg-pink-500",
    "bg-indigo-500",
    "bg-teal-500",
  ]

  const hash = name.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc)
  }, 0)

  return colors[Math.abs(hash) % colors.length]
}
