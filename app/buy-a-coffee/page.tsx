"use client";
import PageTemplate from "@/components/elements/PageTemplate";
import { Separator } from "@/components/ui/separator";
import React from "react";
import Image from "next/image";
import BannerImage from "@/public/images/TaskFlow Banner.png";
import { motion } from "framer-motion";
import Coffee01Icon from "@/public/svg/icons/Coffee01Icon";
import BuyMeACoffeeBrandLogo from "@/public/svg/icons/BuyMeACoffeeBrandLogo";
import CustomLinkButton from "@/components/elements/CustomLinkButton";
import { baseRedColor } from "@/lib/Colors";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.8,
      ease: "easeInOut",
      staggerChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function SupportMe() {
  return (
    <PageTemplate>
      <motion.div
        className="max-w-3xl mx-auto py-5 px-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          className="mb-6 rounded-2xl overflow-hidden shadow-lg"
          variants={itemVariants}
        >
          <Image src={BannerImage} alt="TaskFlow Banner" placeholder="blur" />
        </motion.div>

        <motion.h1
          className="text-3xl md:text-4xl font-bold text-gray-800 dark:text-white mb-8"
          variants={itemVariants}
        >
          Support <span className={`text-red-500`}>TaskFlow</span>
        </motion.h1>
        <motion.div
          className="text-gray-700 dark:text-gray-300 space-y-8"
          variants={containerVariants}
        >
          <motion.p
            className="text-base md:text-lg leading-relaxed mb-6"
            variants={itemVariants}
          >
            Your support helps keep TaskFlow free and lets us continue building
            useful tools that improve your productivity and organization.
          </motion.p>
          <motion.h2
            className="text-lg md:text-xl font-semibold text-gray-800 dark:text-white mb-4"
            variants={itemVariants}
          >
            How Can You Support?
          </motion.h2>
          <motion.ul
            className="list-disc pl-6 space-y-2 text-start"
            variants={itemVariants}
          >
            <motion.li
              className="text-base md:text-lg leading-relaxed"
              variants={itemVariants}
            >
              Consider buying me a coffee to fuel late-night coding sessions!
            </motion.li>
            <motion.li
              className="text-base md:text-lg leading-relaxed"
              variants={itemVariants}
            >
              Your support helps in covering website hosting costs and
              tools/software used for content creation.
            </motion.li>
          </motion.ul>
          <Separator className="my-8 dark:bg-slate-700" />

          <motion.h2
            className="text-lg md:text-xl font-semibold text-gray-800 dark:text-white mb-4"
            variants={itemVariants}
          >
            Payment Options
          </motion.h2>
          <motion.div
            className="border rounded-2xl p-2"
            variants={itemVariants}
          >
            <motion.div>
              <CustomLinkButton
                onClick={() =>
                  window.open(
                    "https://github.com/amansri-30/TaskFlow",
                    "_blank"
                  )
                }
                leftIcon={<Coffee01Icon />}
                className="mb-2"
              >
                Support the project on GitHub
              </CustomLinkButton>
            </motion.div>

            <motion.p
              className="text-xs flex justify-center items-center gap-1"
              variants={itemVariants}
            >
              Powered by <BuyMeACoffeeBrandLogo />
            </motion.p>
          </motion.div>

          <Separator className="my-8 dark:bg-slate-700" />
          <motion.h2
            className="text-lg md:text-xl font-semibold text-gray-800 dark:text-white mb-4"
            variants={itemVariants}
          >
            About TaskFlow
          </motion.h2>
          <motion.p
            className="text-base md:text-lg leading-relaxed mb-6"
            variants={itemVariants}
          >
            TaskFlow is a task management app built to help people improve their
            daily productivity and organization. It combines a clean interface
            with the core tools you need to plan your day: tasks, priorities,
            due dates, lists, and filters. We are always experimenting with new
            ideas to make staying organized simpler and more enjoyable.
          </motion.p>
        </motion.div>
      </motion.div>
    </PageTemplate>
  );
}
