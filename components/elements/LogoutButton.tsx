"use client"
import React from 'react'
import { Button } from '../ui/button'
import toast from 'react-hot-toast'
import { useAppDispatch, useAppSelector } from '@/hooks'
import { logoutUser } from '@/redux/user/userSlice'
import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const isAuthenticated = useAppSelector((state) => state.user.isAuthenticated);

  async function LogoutHandler() {
    try {
      await dispatch(logoutUser()).unwrap();
      toast.success("Logged Out Successfully");
      router.push("/");
    } catch (error) {
      toast.error("Error Occured in Logout");
    }
  }

  if (!isAuthenticated) return null;

  return (
    <Button size={"lg"} onClick={LogoutHandler}>Logout</Button>
  )
}
